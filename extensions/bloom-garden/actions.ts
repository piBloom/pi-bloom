/**
 * Handler / business logic for bloom-garden.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { safePath } from "../../lib/filesystem.js";
import { stringifyFrontmatter } from "../../lib/frontmatter.js";
import { errorResult, nowIso, truncate } from "../../lib/shared.js";
import type { BlueprintVersions } from "./types.js";

const BLOOM_DIRS = ["Persona", "Skills", "Evolutions", "audit"];

const PERSONA_FILES = ["SOUL.md", "BODY.md", "FACULTY.md", "SKILL.md"];

const STIGNORE_CONTENT = `// Device-specific exclusions (used by sync services)
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

// --- Package helpers ---

export function getPackageDir(): string {
	return path.join(fileURLToPath(import.meta.url), "../..");
}

export function getPackageVersion(packageDir: string): string {
	try {
		const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf-8"));
		return (pkg.version as string) ?? "0.1.0";
	} catch {
		return "0.1.0";
	}
}

// --- Blueprint versioning ---

export function readBlueprintVersions(bloomDir: string): BlueprintVersions {
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

export function writeBlueprintVersions(bloomDir: string, versions: BlueprintVersions): void {
	fs.writeFileSync(path.join(bloomDir, "blueprint-versions.json"), `${JSON.stringify(versions, null, 2)}\n`);
}

// --- Directory setup ---

export function ensureBloom(bloomDir: string): void {
	for (const dir of BLOOM_DIRS) {
		fs.mkdirSync(path.join(bloomDir, dir), { recursive: true });
	}
}

export function ensureStignore(homeDir: string): void {
	const stignore = path.join(homeDir, ".stignore");
	if (!fs.existsSync(stignore)) {
		fs.writeFileSync(stignore, STIGNORE_CONTENT);
	}
}

// --- Hashing ---

export function hashContent(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

// --- Blueprint seeding ---

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

export function seedBlueprints(bloomDir: string, packageDir: string): void {
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

// --- Tool handlers ---

export function handleGardenStatus(bloomDir: string) {
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
}

export function handleUpdateBlueprints(bloomDir: string, packageDir: string): number {
	const versions = readBlueprintVersions(bloomDir);
	const updates = Object.entries(versions.updatesAvailable);
	if (updates.length === 0) return 0;

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
	return updates.length;
}

export function handleSkillCreate(bloomDir: string, params: { name: string; description: string; content: string }) {
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
}

export function handleSkillList(bloomDir: string) {
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
}

export function handlePersonaEvolve(
	bloomDir: string,
	params: { layer: string; slug: string; title: string; proposal: string },
) {
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
}

/** Discover skill paths for dynamic loading. */
export function discoverSkillPaths(bloomDir: string): string[] | undefined {
	const skillsDir = path.join(bloomDir, "Skills");
	if (!fs.existsSync(skillsDir)) return undefined;
	return [skillsDir];
}
