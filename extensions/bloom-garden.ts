/**
 * bloom-garden — Bloom directory management, blueprint seeding, skill creation, persona evolution.
 *
 * @tools garden_status, skill_create, skill_list, persona_evolve
 * @commands /bloom (init | status | update-blueprints)
 * @hooks session_start, resources_discover
 * @see {@link ../AGENTS.md#bloom-garden} Extension reference
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { errorResult, getBloomDir, nowIso, safePath, stringifyFrontmatter, truncate } from "../lib/shared.js";

function getPackageDir(): string {
	return path.join(fileURLToPath(import.meta.url), "../..");
}

function getPackageVersion(packageDir: string): string {
	try {
		const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf-8"));
		return (pkg.version as string) ?? "0.1.0";
	} catch {
		return "0.1.0";
	}
}

const BLOOM_DIRS = ["Persona", "Skills", "Evolutions", "audit"];

const PERSONA_FILES = ["SOUL.md", "BODY.md", "FACULTY.md", "SKILL.md"];

interface BlueprintVersions {
	packageVersion: string;
	seeded: Record<string, string>;
	seededHashes: Record<string, string>;
	updatesAvailable: Record<string, string>;
}

function readBlueprintVersions(bloomDir: string): BlueprintVersions {
	const fp = path.join(bloomDir, "blueprint-versions.json");
	try {
		const parsed = JSON.parse(fs.readFileSync(fp, "utf-8")) as Partial<BlueprintVersions>;
		return {
			packageVersion: parsed.packageVersion ?? "0.0.0",
			seeded: parsed.seeded ?? {},
			seededHashes: parsed.seededHashes ?? {},
			updatesAvailable: parsed.updatesAvailable ?? {},
		};
	} catch {
		return { packageVersion: "0.0.0", seeded: {}, seededHashes: {}, updatesAvailable: {} };
	}
}

function writeBlueprintVersions(bloomDir: string, versions: BlueprintVersions): void {
	fs.writeFileSync(path.join(bloomDir, "blueprint-versions.json"), `${JSON.stringify(versions, null, 2)}\n`);
}

function ensureBloom(bloomDir: string): void {
	for (const dir of BLOOM_DIRS) {
		fs.mkdirSync(path.join(bloomDir, dir), { recursive: true });
	}
}

const STIGNORE_CONTENT = `// Syncthing device-specific exclusions
.pi
.ssh
.gnupg
.config/containers
.config/systemd
.config/bloom/channel-tokens
.local
.cache
.mozilla
.pki
node_modules
*.sock
.git
`;

function ensureStignore(homeDir: string): void {
	const stignore = path.join(homeDir, ".stignore");
	if (!fs.existsSync(stignore)) {
		fs.writeFileSync(stignore, STIGNORE_CONTENT);
	}
}

function hashContent(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

function blueprintDestPath(bloomDir: string, key: string): string {
	if (key.startsWith("persona/")) {
		return path.join(bloomDir, "Persona", key.replace(/^persona\//, ""));
	}
	if (key.startsWith("skills/")) {
		return path.join(bloomDir, "Skills", key.replace(/^skills\//, ""));
	}
	if (key === "guardrails.yaml") {
		return path.join(bloomDir, "guardrails.yaml");
	}
	return path.join(bloomDir, key);
}

function seedFile(src: string, dest: string, key: string, version: string, versions: BlueprintVersions): void {
	if (!fs.existsSync(src)) return;

	const srcContent = fs.readFileSync(src, "utf-8");
	const srcHash = hashContent(srcContent);

	if (!fs.existsSync(dest)) {
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.writeFileSync(dest, srcContent);
		versions.seeded[key] = version;
		versions.seededHashes[key] = srcHash;
		delete versions.updatesAvailable[key];
		return;
	}

	const destContent = fs.readFileSync(dest, "utf-8");
	const destHash = hashContent(destContent);
	const previousSeedHash = versions.seededHashes[key];

	if (destHash === srcHash) {
		versions.seeded[key] = version;
		versions.seededHashes[key] = srcHash;
		delete versions.updatesAvailable[key];
		return;
	}

	// If the destination file was never modified by the user since our last seed,
	// apply the updated blueprint automatically.
	if (previousSeedHash && destHash === previousSeedHash) {
		fs.writeFileSync(dest, srcContent);
		versions.seeded[key] = version;
		versions.seededHashes[key] = srcHash;
		delete versions.updatesAvailable[key];
		return;
	}

	versions.updatesAvailable[key] = version;
}

function seedBlueprints(bloomDir: string, packageDir: string): void {
	const version = getPackageVersion(packageDir);
	const versions = readBlueprintVersions(bloomDir);

	for (const file of PERSONA_FILES) {
		const key = `persona/${file}`;
		const src = path.join(packageDir, "persona", file);
		const dest = path.join(bloomDir, "Persona", file);
		seedFile(src, dest, key, version, versions);
	}

	const skillsDir = path.join(packageDir, "skills");
	if (fs.existsSync(skillsDir)) {
		for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const key = `skills/${entry.name}/SKILL.md`;
			const src = path.join(skillsDir, entry.name, "SKILL.md");
			const dest = path.join(bloomDir, "Skills", entry.name, "SKILL.md");
			seedFile(src, dest, key, version, versions);
		}
	}

	// Seed guardrails policy
	seedFile(
		path.join(packageDir, "guardrails.yaml"),
		path.join(bloomDir, "guardrails.yaml"),
		"guardrails.yaml",
		version,
		versions,
	);

	versions.packageVersion = version;
	writeBlueprintVersions(bloomDir, versions);
}

export default function (pi: ExtensionAPI) {
	const bloomDir = getBloomDir();
	const packageDir = getPackageDir();

	pi.on("session_start", (_event, ctx) => {
		ensureBloom(bloomDir);
		seedBlueprints(bloomDir, packageDir);
		ensureStignore(os.homedir());
		process.env._BLOOM_DIR_RESOLVED = bloomDir;

		const versions = readBlueprintVersions(bloomDir);
		const updates = Object.keys(versions.updatesAvailable);
		if (ctx.hasUI) {
			if (updates.length > 0) {
				ctx.ui.setWidget("bloom-updates", [
					`${updates.length} blueprint update(s) available — /bloom update-blueprints`,
				]);
			}
			ctx.ui.setStatus("bloom-garden", `Bloom: ${bloomDir}`);
		}
	});

	pi.registerTool({
		name: "garden_status",
		label: "Bloom Status",
		description: "Show Bloom directory location and blueprint state",
		promptSnippet: "Show Bloom directory status and blueprint state",
		promptGuidelines: ["Use garden_status to check the Bloom directory state."],
		parameters: Type.Object({}),
		async execute() {
			const lines: string[] = [`Bloom: ${bloomDir}`, ""];

			const versions = readBlueprintVersions(bloomDir);
			lines.push(`Package version: ${versions.packageVersion}`);
			lines.push(`Seeded blueprints: ${Object.keys(versions.seeded).length}`);

			const updates = Object.keys(versions.updatesAvailable);
			if (updates.length > 0) {
				lines.push(`Updates available: ${updates.join(", ")}`);
			}

			return {
				content: [{ type: "text" as const, text: truncate(lines.join("\n")) }],
				details: {},
			};
		},
	});

	pi.registerCommand("bloom", {
		description: "Bloom directory management: /bloom init | status | update-blueprints",
		handler: async (args: string, ctx) => {
			const sub = args.trim().split(/\s+/)[0] ?? "";

			switch (sub) {
				case "init": {
					ensureBloom(bloomDir);
					seedBlueprints(bloomDir, packageDir);
					ctx.ui.notify("Bloom initialized", "info");
					break;
				}
				case "status": {
					pi.sendUserMessage("Show bloom status using the garden_status tool.", { deliverAs: "followUp" });
					break;
				}
				case "update-blueprints": {
					const versions = readBlueprintVersions(bloomDir);
					const updates = Object.entries(versions.updatesAvailable);
					if (updates.length === 0) {
						ctx.ui.notify("All blueprints are up to date", "info");
						break;
					}
					for (const [key, version] of updates) {
						const src = path.join(packageDir, key);
						const dest = blueprintDestPath(bloomDir, key);
						if (!fs.existsSync(src)) continue;
						const srcContent = fs.readFileSync(src, "utf-8");
						fs.mkdirSync(path.dirname(dest), { recursive: true });
						fs.writeFileSync(dest, srcContent);
						versions.seeded[key] = version;
						versions.seededHashes[key] = hashContent(srcContent);
						delete versions.updatesAvailable[key];
					}
					writeBlueprintVersions(bloomDir, versions);
					ctx.ui.notify(`Updated ${updates.length} blueprint(s)`, "info");
					break;
				}
				default: {
					ctx.ui.notify("Usage: /bloom init | status | update-blueprints", "info");
					break;
				}
			}
		},
	});

	// --- Dynamic skill discovery ---

	pi.on("resources_discover", () => {
		const skillsDir = path.join(bloomDir, "Skills");
		if (!fs.existsSync(skillsDir)) return;
		return { skillPaths: [skillsDir] };
	});

	// --- Skill self-creation tools ---

	pi.registerTool({
		name: "skill_create",
		label: "Create Skill",
		description: "Create a new skill markdown file in the Bloom directory",
		promptSnippet: "Create a new SKILL.md in ~/Bloom/Skills/",
		promptGuidelines: [
			"Use skill_create when the user wants to teach Bloom a new capability.",
			"Skills are markdown files with YAML frontmatter (name, description) and structured instructions.",
		],
		parameters: Type.Object({
			name: Type.String({ description: "Skill name (kebab-case, e.g. meal-planning)" }),
			description: Type.String({ description: "One-line skill description" }),
			content: Type.String({ description: "Skill body in markdown (instructions, guidelines, examples)" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			let skillDir: string;
			try {
				skillDir = safePath(bloomDir, "Skills", params.name);
			} catch {
				return errorResult("Path traversal blocked: invalid skill name");
			}
			const filepath = path.join(skillDir, "SKILL.md");

			if (fs.existsSync(filepath)) {
				return errorResult(`skill already exists: ${params.name}`);
			}

			fs.mkdirSync(skillDir, { recursive: true });
			const frontmatter = `---\nname: ${params.name}\ndescription: ${params.description}\n---\n\n`;
			fs.writeFileSync(filepath, frontmatter + params.content);

			return {
				content: [{ type: "text" as const, text: `created skill: ${params.name} at ${filepath}` }],
				details: {},
			};
		},
	});

	pi.registerTool({
		name: "skill_list",
		label: "List Skills",
		description: "List all skills in the Bloom directory",
		promptSnippet: "List skills in ~/Bloom/Skills/",
		promptGuidelines: ["Use skill_list to show available Bloom skills."],
		parameters: Type.Object({}),
		async execute() {
			const skillsDir = path.join(bloomDir, "Skills");
			if (!fs.existsSync(skillsDir)) {
				return { content: [{ type: "text" as const, text: "No skills directory found." }], details: {} };
			}

			const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
			const skills: string[] = [];

			for (const entry of entries) {
				if (!entry.isDirectory()) continue;
				const skillFile = path.join(skillsDir, entry.name, "SKILL.md");
				if (!fs.existsSync(skillFile)) continue;
				const raw = fs.readFileSync(skillFile, "utf-8");
				const descMatch = raw.match(/^description:\s*(.+)$/m);
				const desc = descMatch ? descMatch[1] : "(no description)";
				skills.push(`${entry.name} — ${desc}`);
			}

			const text = skills.length > 0 ? skills.join("\n") : "No skills found in Bloom.";
			return { content: [{ type: "text" as const, text }], details: {} };
		},
	});

	// --- Persona evolution ---

	pi.registerTool({
		name: "persona_evolve",
		label: "Propose Persona Change",
		description: "Propose a change to a persona layer, tracked as an evolution object",
		promptSnippet: "Propose a change to Bloom's persona (requires user approval)",
		promptGuidelines: [
			"Use persona_evolve to propose changes to SOUL.md, BODY.md, FACULTY.md, or SKILL.md.",
			"Changes are tracked as evolution objects and require explicit user approval before applying.",
		],
		parameters: Type.Object({
			layer: Type.String({ description: "Persona layer to change: SOUL, BODY, FACULTY, or SKILL" }),
			slug: Type.String({ description: "Evolution slug (e.g. add-health-awareness)" }),
			title: Type.String({ description: "Short description of the proposed change" }),
			proposal: Type.String({ description: "Detailed description of what to change and why" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const validLayers = ["SOUL", "BODY", "FACULTY", "SKILL"];
			if (!validLayers.includes(params.layer.toUpperCase())) {
				return errorResult(`invalid layer: ${params.layer} (expected: ${validLayers.join(", ")})`);
			}

			const evoDir = path.join(bloomDir, "Evolutions");
			fs.mkdirSync(evoDir, { recursive: true });

			const filepath = path.join(evoDir, `${params.slug}.pi.md`);
			if (fs.existsSync(filepath)) {
				return errorResult(`evolution already exists: ${params.slug}`);
			}

			const data: Record<string, unknown> = {
				type: "evolution",
				slug: params.slug,
				title: params.title,
				layer: params.layer.toUpperCase(),
				status: "proposed",
				risk: "low",
				area: "persona",
				created: nowIso(),
			};

			fs.writeFileSync(filepath, stringifyFrontmatter(data, `\n${params.proposal}\n`));

			return {
				content: [
					{
						type: "text" as const,
						text: `proposed persona evolution: ${params.slug}\nlayer: ${params.layer.toUpperCase()}\nstatus: proposed\n\nThe user must approve this evolution before it can be applied.`,
					},
				],
				details: {},
			};
		},
	});
}
