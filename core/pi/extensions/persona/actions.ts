/**
 * Handler / business logic for persona.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import jsYaml from "js-yaml";
import {
	getNixPiDir,
	getPiDir,
	getSystemReadyPath,
	getUpdateStatusPath,
	getWizardStateDir,
	resolvePackageDir,
} from "../../../lib/filesystem.js";
import { createLogger } from "../../../lib/logging.js";
import type { GuardrailsConfig, NixPiContext } from "./types.js";

const log = createLogger("persona");
const PERSONA_LAYERS: Array<[string, string]> = [
	["Soul", "SOUL.md"],
	["Body", "BODY.md"],
	["Faculty", "FACULTY.md"],
	["Skill", "SKILL.md"],
];

/** Collapse whitespace so `rm  -rf` or `rm\t-rf` can't bypass patterns. */
export function normalizeCommand(cmd: string): string {
	return cmd.replace(/\s+/g, " ");
}

function resolveGuardrailsPath(): string | null {
	const workspaceDir = getNixPiDir();
	const packageDir = resolvePackageDir(import.meta.url);
	const gardenPath = join(workspaceDir, "guardrails.yaml");
	if (existsSync(gardenPath)) {
		return gardenPath;
	}

	const defaultPath = join(packageDir, "guardrails.yaml");
	return existsSync(defaultPath) ? defaultPath : null;
}

function compileGuardrailRules(config: GuardrailsConfig): Array<{ tool: string; pattern: RegExp; label: string }> {
	const compiled: Array<{ tool: string; pattern: RegExp; label: string }> = [];
	for (const rule of config.rules) {
		if (rule.action !== "block" || !rule.patterns) continue;
		for (const pattern of rule.patterns) {
			try {
				compiled.push({ tool: rule.tool, pattern: new RegExp(pattern.pattern), label: pattern.label });
			} catch (patternErr) {
				log.error(`Skipping invalid guardrail pattern "${pattern.pattern}"`, {
					error: (patternErr as Error).message,
				});
			}
		}
	}
	return compiled;
}

/** Load and compile guardrail patterns from YAML config. */
export function loadGuardrails(): Array<{ tool: string; pattern: RegExp; label: string }> {
	const filePath = resolveGuardrailsPath();
	if (!filePath) return [];

	try {
		const raw = readFileSync(filePath, "utf-8");
		const config = jsYaml.load(raw) as GuardrailsConfig;
		if (!config?.rules) return [];
		return compileGuardrailRules(config);
	} catch (err) {
		log.error("Failed to load guardrails", { error: (err as Error).message });
		return [];
	}
}

/** Get the path to the NixPI context persistence file. */
function getContextFile(): string {
	return join(getPiDir(), "nixpi-context.json");
}

function readJsonFile<T>(filepath: string): T | null {
	try {
		if (!existsSync(filepath)) return null;
		return JSON.parse(readFileSync(filepath, "utf-8")) as T;
	} catch {
		return null;
	}
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
	return readJsonFile<NixPiContext>(getContextFile());
}

/** Check if an OS update is available by reading the update-status file. */
export function checkUpdateAvailable(): boolean {
	const status = readJsonFile<{ available?: boolean }>(getUpdateStatusPath());
	return status?.available === true;
}

/** Build the restored-context system prompt block from persisted compaction state. */
export function buildRestoredContextBlock(ctx: NixPiContext): string {
	const lines = ["\n\n[RESTORED CONTEXT]"];
	if (ctx.updateAvailable) lines.push("OS update available — inform user if not already done.");
	lines.push(`Context saved at: ${ctx.savedAt}`);
	return lines.join("\n");
}

function resolveDefaultPersonaDir(packageDir: string): string {
	const packagedPersonaDir = join(packageDir, "core", "pi", "persona");
	return existsSync(packagedPersonaDir) ? packagedPersonaDir : join(packageDir, "persona");
}

function resolvePersonaDir(): string {
	const workspaceDir = getNixPiDir();
	const vaultDir = join(workspaceDir, "Persona");
	if (existsSync(join(vaultDir, "SOUL.md"))) {
		return vaultDir;
	}

	const packageDir = resolvePackageDir(import.meta.url);
	return resolveDefaultPersonaDir(packageDir);
}

function loadPersonaSection(dir: string, title: string, file: string): string {
	const content = readFileSync(join(dir, file), "utf-8").trim();
	return `### ${title}\n\n${content}`;
}

/** Load the 4-layer persona from the runtime directory or default package persona. */
export function loadPersona(): string {
	const dir = resolvePersonaDir();
	const sections = PERSONA_LAYERS.map(([title, file]) => loadPersonaSection(dir, title, file)).join("\n\n");
	return `## Pi Persona\n\n${sections}`;
}

export function isSystemSetupPending(): boolean {
	return !existsSync(getSystemReadyPath());
}

export function buildSystemSetupBlock(): string {
	return [
		"",
		"## System Setup",
		"",
		"The machine is not fully configured yet. Stay in setup mode until onboarding is complete.",
		"Use Pi as the primary interface, starting with `/login` and `/model` if authentication or model selection is still missing.",
		"After Pi is ready, guide the user through git identity setup for /srv/nixpi, WireGuard, OS security configuration, and a short NixPI tutorial.",
		"Only write the final completion marker when the full onboarding flow is complete.",
		`Completion marker: ${getSystemReadyPath()}`,
		`Wizard state dir: ${getWizardStateDir()}`,
	].join("\n");
}
