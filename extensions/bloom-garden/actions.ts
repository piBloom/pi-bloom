/**
 * Handler / business logic for bloom-garden.
 * Package helpers, directory setup, and tool handlers.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { safePath } from "../../lib/filesystem.js";
import { stringifyFrontmatter } from "../../lib/frontmatter.js";
import { errorResult, nowIso, truncate } from "../../lib/shared.js";
import { readBlueprintVersions } from "./actions-blueprints.js";

const BLOOM_DIRS = ["Persona", "Skills", "Evolutions", "audit"];

// --- Package helpers ---

export function getPackageDir(): string {
	// From dist/extensions/bloom-garden/actions.js → project root (3 levels up)
	return path.join(fileURLToPath(import.meta.url), "../../..");
}

export function getPackageVersion(packageDir: string): string {
	try {
		const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf-8"));
		return (pkg.version as string) ?? "0.1.0";
	} catch {
		return "0.1.0";
	}
}

// --- Directory setup ---

export function ensureBloom(bloomDir: string): void {
	for (const dir of BLOOM_DIRS) {
		fs.mkdirSync(path.join(bloomDir, dir), { recursive: true });
	}
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
