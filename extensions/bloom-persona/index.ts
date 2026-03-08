/**
 * bloom-persona — Identity injection, safety guardrails, compaction context.
 *
 * @hooks session_start, before_agent_start, tool_call, session_before_compact
 * @see {@link ../../AGENTS.md#bloom-persona} Extension reference
 */
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadContext, loadGuardrails, loadPersona, normalizeCommand, saveContext } from "./actions.js";

export { normalizeCommand } from "./actions.js";

export default function (pi: ExtensionAPI) {
	let personaBlock: string | undefined;
	let guardrails: ReturnType<typeof loadGuardrails> | undefined;
	let restoredContext: ReturnType<typeof loadContext> = null;
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
			`Tokens before compaction: ${tokensBefore}.`,
		].join("\n");
		return {
			compaction: { summary, firstKeptEntryId, tokensBefore },
		};
	});
}
