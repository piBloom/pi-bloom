/**
 * Handler / business logic for persona.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import jsYaml from "js-yaml";
import {
	getNixPiDir,
	getPersonaDonePath,
	getPiDir,
	getSystemReadyPath,
	getUpdateStatusPath,
	getWizardStateDir,
	resolvePackageDir,
} from "../../../lib/filesystem.js";
import { createLogger } from "../../../lib/logging.js";
import type { GuardrailsConfig, NixPiContext } from "./types.js";

const log = createLogger("persona");

/** Collapse whitespace so `rm  -rf` or `rm\t-rf` can't bypass patterns. */
export function normalizeCommand(cmd: string): string {
	return cmd.replace(/\s+/g, " ");
}

/** Load and compile guardrail patterns from YAML config. */
export function loadGuardrails(): Array<{ tool: string; pattern: RegExp; label: string }> {
	const workspaceDir = getNixPiDir();
	const packageDir = resolvePackageDir(import.meta.url);

	// User customization takes priority over defaults
	const gardenPath = join(workspaceDir, "guardrails.yaml");
	const defaultPath = join(packageDir, "guardrails.yaml");
	const filePath = existsSync(gardenPath) ? gardenPath : defaultPath;

	if (!existsSync(filePath)) return [];

	try {
		const raw = readFileSync(filePath, "utf-8");
		const config = jsYaml.load(raw) as GuardrailsConfig;
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

/** Get the path to the NixPI context persistence file. */
export function getContextFile(): string {
	return join(getPiDir(), "nixpi-context.json");
}

/** Save context state for cross-compaction continuity. */
export function saveContext(ctx: NixPiContext): void {
	try {
		mkdirSync(getPiDir(), { recursive: true });
		writeFileSync(getContextFile(), JSON.stringify(ctx, null, 2));
	} catch (err) {
		log.error("Failed to save context", { error: (err as Error).message });
	}
}

/** Load previously saved context state. */
export function loadContext(): NixPiContext | null {
	try {
		const contextFile = getContextFile();
		if (!existsSync(contextFile)) return null;
		return JSON.parse(readFileSync(contextFile, "utf-8")) as NixPiContext;
	} catch {
		return null;
	}
}

/** Check if an OS update is available by reading the update-status file. */
export function checkUpdateAvailable(): boolean {
	try {
		const statusFile = getUpdateStatusPath();
		if (!existsSync(statusFile)) return false;
		const status = JSON.parse(readFileSync(statusFile, "utf-8"));
		return status.available === true;
	} catch {
		return false;
	}
}

/** Build the restored-context system prompt block from persisted compaction state. */
export function buildRestoredContextBlock(ctx: NixPiContext): string {
	const lines = ["\n\n[RESTORED CONTEXT]"];
	if (ctx.updateAvailable) lines.push("OS update available — inform user if not already done.");
	lines.push(`Context saved at: ${ctx.savedAt}`);
	return lines.join("\n");
}

/** Load the 4-layer persona from the runtime directory or default package persona. */
export function loadPersona(): string {
	const workspaceDir = getNixPiDir();
	const vaultDir = join(workspaceDir, "Persona");
	const packageDir = resolvePackageDir(import.meta.url);
	const defaultPersonaDir = existsSync(join(packageDir, "core", "pi", "persona"))
		? join(packageDir, "core", "pi", "persona")
		: join(packageDir, "persona");
	const dir = existsSync(join(vaultDir, "SOUL.md")) ? vaultDir : defaultPersonaDir;
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
	return `## Pi Persona\n\n${sections}`;
}

export function isPersonaSetupPending(): boolean {
	return existsSync(getSystemReadyPath()) && !existsSync(getPersonaDonePath());
}

export function buildPersonaSetupBlock(): string {
	return [
		"",
		"## Persona Setup",
		"",
		"The machine setup is complete, but persona customization is still pending.",
		"Before normal conversation, guide the user through defining or confirming Pi's persona and operating style.",
		"When the user is satisfied, create the marker file by writing a timestamp to the persona-done path.",
		`Marker path: ${getPersonaDonePath()}`,
		`Wizard state dir: ${getWizardStateDir()}`,
	].join("\n");
}
