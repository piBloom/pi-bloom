/**
 * Handler / business logic for bloom-persona.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getBloomDir } from "../../lib/filesystem.js";
import { yaml } from "../../lib/frontmatter.js";
import { createLogger } from "../../lib/shared.js";
import type { BloomContext, GuardrailsConfig } from "./types.js";

const log = createLogger("bloom-persona");

/** Collapse whitespace so `rm  -rf` or `rm\t-rf` can't bypass patterns. */
export function normalizeCommand(cmd: string): string {
	return cmd.replace(/\s+/g, " ");
}

/** Load and compile guardrail patterns from YAML config. */
export function loadGuardrails(): Array<{ tool: string; pattern: RegExp; label: string }> {
	const bloomDir = getBloomDir();
	const packageDir = join(fileURLToPath(import.meta.url), "../../..");

	// User customization takes priority over defaults
	const gardenPath = join(bloomDir, "guardrails.yaml");
	const defaultPath = join(packageDir, "guardrails.yaml");
	const filePath = existsSync(gardenPath) ? gardenPath : defaultPath;

	if (!existsSync(filePath)) return [];

	try {
		const raw = readFileSync(filePath, "utf-8");
		const config = yaml.load(raw) as GuardrailsConfig;
		if (!config?.rules) return [];

		const compiled: Array<{ tool: string; pattern: RegExp; label: string }> = [];
		for (const rule of config.rules) {
			if (rule.action !== "block" || !rule.patterns) continue;
			for (const p of rule.patterns) {
				try {
					compiled.push({ tool: rule.tool, pattern: new RegExp(p.pattern), label: p.label });
				} catch (patternErr) {
					log.error(`Skipping invalid guardrail pattern "${p.pattern}"`, {
						error: (patternErr as Error).message,
					});
				}
			}
		}
		return compiled;
	} catch (err) {
		log.error("Failed to load guardrails", { error: (err as Error).message });
		return [];
	}
}

/** Get the path to the bloom context persistence file. */
export function getContextFile(): string {
	return join(os.homedir(), ".pi", "bloom-context.json");
}

/** Save context state for cross-compaction continuity. */
export function saveContext(ctx: BloomContext): void {
	try {
		mkdirSync(join(os.homedir(), ".pi"), { recursive: true });
		writeFileSync(getContextFile(), JSON.stringify(ctx, null, 2));
	} catch (err) {
		log.error("Failed to save context", { error: (err as Error).message });
	}
}

/** Load previously saved context state. */
export function loadContext(): BloomContext | null {
	try {
		const contextFile = getContextFile();
		if (!existsSync(contextFile)) return null;
		return JSON.parse(readFileSync(contextFile, "utf-8")) as BloomContext;
	} catch {
		return null;
	}
}

/** Load the 4-layer persona from Bloom dir or default package persona. */
export function loadPersona(): string {
	const bloomDir = getBloomDir();
	const vaultDir = join(bloomDir, "Persona");
	const dir = existsSync(join(vaultDir, "SOUL.md")) ? vaultDir : join(fileURLToPath(import.meta.url), "../../../persona");
	const layers: Array<[string, string]> = [
		["Soul", "SOUL.md"],
		["Body", "BODY.md"],
		["Faculty", "FACULTY.md"],
		["Skill", "SKILL.md"],
	];
	const sections = layers
		.map(([title, file]) => {
			const content = readFileSync(join(dir, file), "utf-8").trim();
			return `### ${title}\n\n${content}`;
		})
		.join("\n\n");
	return `## Bloom Persona\n\n${sections}`;
}
