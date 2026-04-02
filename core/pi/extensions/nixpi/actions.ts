/**
 * Handler / business logic for nixpi.
 * Package helpers, directory setup, and tool handlers.
 */
import fs from "node:fs";
import path from "node:path";
import { readPackageVersion, resolvePackageDir, safePath } from "../../../lib/filesystem.js";
import { stringifyFrontmatter } from "../../../lib/frontmatter.js";
import { errorResult, nowIso, textToolResult, truncate } from "../../../lib/utils.js";
import { readBlueprintVersions } from "./actions-blueprints.js";

const NIXPI_DIRS = ["Persona", "Skills", "Evolutions", "Objects", "Episodes", "Agents", "audit"];

// --- Package helpers ---

export function getPackageDir(): string {
	return resolvePackageDir(import.meta.url);
}

export function getPackageVersion(packageDir: string): string {
	return readPackageVersion(packageDir);
}

// --- Directory setup ---

export function ensureNixPi(nixPiDir: string): void {
	for (const dir of NIXPI_DIRS) {
		fs.mkdirSync(path.join(nixPiDir, dir), { recursive: true });
	}
}

// --- Tool handlers ---

export function handleNixPiStatus(nixPiDir: string) {
	const lines: string[] = [`NixPI: ${nixPiDir}`, ""];

	const versions = readBlueprintVersions(nixPiDir);
	lines.push(`Package version: ${versions.packageVersion}`);
	lines.push(`Seeded blueprints: ${Object.keys(versions.seeded).length}`);

	const updates = Object.keys(versions.updatesAvailable);
	if (updates.length > 0) {
		lines.push(`Updates available: ${updates.join(", ")}`);
	}

	return textToolResult(truncate(lines.join("\n")));
}

export function handleSkillCreate(
	workspaceDir: string,
	params: { name: string; description: string; content: string },
) {
	let skillDir: string;
	try {
		skillDir = safePath(workspaceDir, "Skills", params.name);
	} catch {
		return errorResult("Path traversal blocked: invalid skill name");
	}
	const filepath = path.join(skillDir, "SKILL.md");

	if (fs.existsSync(filepath)) {
		return errorResult(`skill already exists: ${params.name}`);
	}

	fs.mkdirSync(skillDir, { recursive: true });
	const content = stringifyFrontmatter({ name: params.name, description: params.description }, `\n${params.content}\n`);
	fs.writeFileSync(filepath, content);

	return textToolResult(`created skill: ${params.name} at ${filepath}`);
}

export function handleSkillList(workspaceDir: string) {
	const skillsDir = path.join(workspaceDir, "Skills");
	if (!fs.existsSync(skillsDir)) {
		return textToolResult("No skills directory found.");
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

	const text = skills.length > 0 ? skills.join("\n") : "No skills found in NixPI.";
	return textToolResult(text);
}

export function handlePersonaEvolve(
	workspaceDir: string,
	params: { layer: string; slug: string; title: string; proposal: string },
) {
	const validLayers = ["SOUL", "BODY", "FACULTY", "SKILL"];
	if (!validLayers.includes(params.layer.toUpperCase())) {
		return errorResult(`invalid layer: ${params.layer} (expected: ${validLayers.join(", ")})`);
	}

	const evoDir = path.join(workspaceDir, "Evolutions");
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

	return textToolResult(
		`proposed persona evolution: ${params.slug}\nlayer: ${params.layer.toUpperCase()}\nstatus: proposed\n\nThe user must approve this evolution before it can be applied.`,
	);
}

/** Discover skill paths for dynamic loading. */
export function discoverSkillPaths(workspaceDir: string): string[] | undefined {
	const skillsDir = path.join(workspaceDir, "Skills");
	if (!fs.existsSync(skillsDir)) return undefined;
	return [skillsDir];
}
