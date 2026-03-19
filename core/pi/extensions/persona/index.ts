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
	checkUpdateAvailable,
	loadContext,
	loadGuardrails,
	loadPersona,
	normalizeCommand,
	saveContext,
} from "./actions.js";

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
		if (personaBlock === undefined) {
			personaBlock = loadPersona();
		}

		let systemPrompt = `${personaBlock}\n\n${event.systemPrompt}`;

		// Inject restored context once after compaction
		if (restoredContext === undefined) {
			restoredContext = loadContext();
		}
		if (restoredContext) {
			systemPrompt += buildRestoredContextBlock(restoredContext);
			restoredContext = null;
		}

		if (memoryDigest === undefined) {
			memoryDigest = buildMemoryDigest(ctx.cwd);
		}
		if (memoryDigest) {
			systemPrompt += memoryDigest;
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

		const updateAvailable = checkUpdateAvailable();

		saveContext({
			savedAt: new Date().toISOString(),
			updateAvailable,
		});

		const summary = [
			"COMPACTION GUIDANCE — preserve the following across summarization:",
			"1. Pi persona identity: values, voice, growth stage, and boundaries.",
			"2. Human context: name, preferences, recurring topics, and active projects.",
			"3. Task state: in-progress tasks, open threads, and decisions pending.",
			`Tokens before compaction: ${tokensBefore}.`,
		].join("\n");
		return {
			compaction: { summary, firstKeptEntryId, tokensBefore },
		};
	});
}
