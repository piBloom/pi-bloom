import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getGardenDir } from "./shared.js";

const require = createRequire(import.meta.url);
const yaml: { load: (str: string) => unknown } = require("js-yaml");

interface GuardrailPattern {
	pattern: string;
	label: string;
}

interface GuardrailRule {
	tool: string;
	action: "block";
	patterns: GuardrailPattern[];
}

interface GuardrailsConfig {
	rules: GuardrailRule[];
}

/** Collapse whitespace so `rm  -rf` or `rm\t-rf` can't bypass patterns. */
function normalizeCommand(cmd: string): string {
	return cmd.replace(/\s+/g, " ");
}

function loadGuardrails(): Array<{ tool: string; pattern: RegExp; label: string }> {
	const gardenDir = getGardenDir();
	const packageDir = join(fileURLToPath(import.meta.url), "../..");

	// User customization takes priority over defaults
	const gardenPath = join(gardenDir, "Bloom", "guardrails.yaml");
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
				compiled.push({ tool: rule.tool, pattern: new RegExp(p.pattern), label: p.label });
			}
		}
		return compiled;
	} catch (err) {
		console.error("[bloom-persona] Failed to load guardrails:", (err as Error).message);
		return [];
	}
}

interface BloomContext {
	savedAt: string;
	activeTopic?: string;
	pendingChannels: number;
	updateAvailable: boolean;
}

const CONTEXT_FILE = join(os.homedir(), ".pi", "bloom-context.json");

function saveContext(ctx: BloomContext): void {
	try {
		mkdirSync(join(os.homedir(), ".pi"), { recursive: true });
		writeFileSync(CONTEXT_FILE, JSON.stringify(ctx, null, 2));
	} catch (err) {
		console.error("[bloom-persona] Failed to save context:", (err as Error).message);
	}
}

function loadContext(): BloomContext | null {
	try {
		if (!existsSync(CONTEXT_FILE)) return null;
		return JSON.parse(readFileSync(CONTEXT_FILE, "utf-8")) as BloomContext;
	} catch {
		return null;
	}
}

function loadPersona(): string {
	const gardenDir = getGardenDir();
	const vaultDir = join(gardenDir, "Bloom", "Persona");
	const dir = existsSync(join(vaultDir, "SOUL.md")) ? vaultDir : join(fileURLToPath(import.meta.url), "../../persona");
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

export default function (pi: ExtensionAPI) {
	let personaBlock: string | undefined;
	let guardrails: Array<{ tool: string; pattern: RegExp; label: string }> | undefined;
	let restoredContext: BloomContext | null = null;
	let contextRestored = false;

	pi.on("session_start", () => {
		pi.setSessionName("Bloom");
	});

	pi.on("before_agent_start", async (event) => {
		if (personaBlock === undefined) {
			personaBlock = loadPersona();
		}

		let systemPrompt = `${personaBlock}\n\n${event.systemPrompt}`;

		// Inject restored context after compaction
		if (!contextRestored) {
			restoredContext = loadContext();
			contextRestored = true;
		}
		if (restoredContext) {
			const ctx = restoredContext;
			restoredContext = null;
			const lines = ["\n\n[RESTORED CONTEXT]"];
			if (ctx.activeTopic) lines.push(`Active topic: ${ctx.activeTopic}`);
			if (ctx.pendingChannels > 0) lines.push(`Pending channel responses: ${ctx.pendingChannels}`);
			if (ctx.updateAvailable) lines.push("OS update available — inform user if not already done.");
			lines.push(`Context saved at: ${ctx.savedAt}`);
			systemPrompt += lines.join("\n");
		}

		return { systemPrompt };
	});

	pi.on("tool_call", async (event) => {
		if (guardrails === undefined) {
			guardrails = loadGuardrails();
		}

		for (const rule of guardrails) {
			if (rule.tool !== event.toolName) continue;

			if (event.toolName === "bash") {
				const raw: string = (event.input as { command?: string }).command ?? "";
				const command = normalizeCommand(raw);
				if (rule.pattern.test(command)) {
					return { block: true, reason: `Blocked dangerous command: ${rule.label}` };
				}
			}
		}
	});

	pi.on("session_before_compact", async (event) => {
		const { firstKeptEntryId, tokensBefore } = event.preparation;

		// Save context before compaction
		let activeTopic: string | undefined;
		for (const entry of event.branchEntries) {
			if (entry.type === "custom" && (entry as { customType?: string }).customType === "bloom-topic") {
				const data = (entry as { data?: { name?: string; status?: string } }).data;
				if (data?.status === "active") activeTopic = data.name;
			}
		}

		let updateAvailable = false;
		try {
			const statusFile = join(os.homedir(), ".bloom", "update-status.json");
			if (existsSync(statusFile)) {
				const status = JSON.parse(readFileSync(statusFile, "utf-8"));
				updateAvailable = status.available === true;
			}
		} catch {
			// Ignore
		}

		saveContext({
			savedAt: new Date().toISOString(),
			activeTopic,
			pendingChannels: 0,
			updateAvailable,
		});

		const summary = [
			"COMPACTION GUIDANCE — preserve the following across summarization:",
			"1. Bloom persona identity: values, voice, growth stage, and boundaries.",
			"2. Human context: name, preferences, recurring topics, and active projects.",
			"3. Task state: in-progress tasks, open threads, and decisions pending.",
			"4. PARA structure: known projects, areas, resources, and archive items.",
			`Tokens before compaction: ${tokensBefore}.`,
		].join("\n");
		return {
			compaction: { summary, firstKeptEntryId, tokensBefore },
		};
	});
}
