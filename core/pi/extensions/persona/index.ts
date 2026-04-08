/**
 * persona — Identity injection, safety guardrails, compaction context.
 *
 * @hooks session_start, before_agent_start, tool_call, session_before_compact
 * @see {@link ../../AGENTS.md#persona} Extension reference
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { buildMemoryDigest } from "../objects/digest.js";
import {
	buildRestoredContextBlock,
	buildSystemSetupBlock,
	checkUpdateAvailable,
	isSystemSetupPending,
	loadContext,
	loadGuardrails,
	loadPersona,
	normalizeCommand,
	saveContext,
} from "./actions.js";

function appendRestoredContext(
	systemPrompt: string,
	restoredContext: ReturnType<typeof loadContext> | undefined,
): string {
	if (!restoredContext) {
		return systemPrompt;
	}
	return systemPrompt + buildRestoredContextBlock(restoredContext);
}

function appendMemoryDigest(systemPrompt: string, memoryDigest: string | undefined): string {
	return memoryDigest ? systemPrompt + memoryDigest : systemPrompt;
}

function appendSystemSetup(systemPrompt: string): string {
	return isSystemSetupPending() ? systemPrompt + buildSystemSetupBlock() : systemPrompt;
}

function buildCompactionSummary(tokensBefore: number): string {
	return [
		"COMPACTION GUIDANCE — preserve the following across summarization:",
		"1. Pi persona identity: values, voice, growth stage, and boundaries.",
		"2. Human context: name, preferences, recurring topics, and active projects.",
		"3. Task state: in-progress tasks, open threads, and decisions pending.",
		`Tokens before compaction: ${tokensBefore}.`,
	].join("\n");
}

function normalizeBashCommand(input: unknown): string {
	return normalizeCommand((input as { command?: string }).command ?? "");
}

export default function (pi: ExtensionAPI) {
	let personaBlock: string | undefined;
	let guardrails: ReturnType<typeof loadGuardrails> | undefined;
	let restoredContext: ReturnType<typeof loadContext> | undefined;
	let memoryDigest: string | undefined;

	pi.on("session_start", () => {
		pi.setSessionName("Pi");
		memoryDigest = undefined;
	});

	pi.on("before_agent_start", async (event, ctx) => {
		personaBlock ??= loadPersona();
		let systemPrompt = `${personaBlock}\n\n${event.systemPrompt}`;

		// Inject restored context once after compaction
		restoredContext ??= loadContext();
		systemPrompt = appendRestoredContext(systemPrompt, restoredContext);
		restoredContext = null;

		memoryDigest ??= buildMemoryDigest(ctx.cwd);
		systemPrompt = appendMemoryDigest(systemPrompt, memoryDigest);

		systemPrompt = appendSystemSetup(systemPrompt);

		return { systemPrompt };
	});

	pi.on("tool_call", async (event) => {
		guardrails ??= loadGuardrails();

		for (const rule of guardrails) {
			if (rule.tool !== event.toolName) continue;

			if (event.toolName === "bash") {
				const command = normalizeBashCommand(event.input);
				if (rule.pattern.test(command)) {
					return { block: true, reason: `Blocked dangerous command: ${rule.label}` };
				}
			}
		}
	});

	pi.on("session_before_compact", async (event) => {
		const { firstKeptEntryId, tokensBefore } = event.preparation;
		saveContext({
			savedAt: new Date().toISOString(),
			updateAvailable: checkUpdateAvailable(),
		});
		return {
			compaction: { summary: buildCompactionSummary(tokensBefore), firstKeptEntryId, tokensBefore },
		};
	});
}
