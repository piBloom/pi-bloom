/**
 * Handler / business logic for bloom-setup.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { run } from "../../lib/exec.js";
import {
	advanceStep,
	createInitialState,
	getNextStep,
	getStepsSummary,
	isSetupComplete,
	type SetupState,
	type StepName,
} from "../../lib/setup.js";
import { createLogger } from "../../lib/shared.js";
import { STEP_GUIDANCE } from "./step-guidance.js";

const log = createLogger("bloom-setup");

const SETUP_STATE_PATH = join(os.homedir(), ".bloom", "setup-state.json");
const SETUP_COMPLETE_PATH = join(os.homedir(), ".bloom", ".setup-complete");

/** Load setup state from disk, or create initial state. */
export function loadState(): SetupState {
	if (existsSync(SETUP_STATE_PATH)) {
		try {
			const raw = readFileSync(SETUP_STATE_PATH, "utf-8");
			return JSON.parse(raw) as SetupState;
		} catch {
			log.warn("corrupt setup-state.json, backing up and creating fresh state");
			const backup = `${SETUP_STATE_PATH}.corrupt-${Date.now()}`;
			try {
				renameSync(SETUP_STATE_PATH, backup);
			} catch {
				// best-effort backup
			}
		}
	}
	return createInitialState();
}

/** Save setup state to disk (atomic write: temp file + rename). */
export function saveState(state: SetupState): void {
	const dir = dirname(SETUP_STATE_PATH);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
	const tmp = `${SETUP_STATE_PATH}.tmp`;
	writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
	renameSync(tmp, SETUP_STATE_PATH);
}

/** Mark setup as complete and enable the persistent Pi agent daemon. */
export async function touchSetupComplete(): Promise<void> {
	const dir = dirname(SETUP_COMPLETE_PATH);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
	writeFileSync(SETUP_COMPLETE_PATH, new Date().toISOString(), "utf-8");

	// Enable linger so user services survive logout
	const user = os.userInfo().username;
	await run("loginctl", ["enable-linger", user]);

	// Enable and start the pi-daemon immediately
	await run("systemctl", ["--user", "enable", "--now", "pi-daemon.service"]);

	// Verify daemon is actually running (not crash-looping)
	const check = await run("systemctl", ["--user", "is-active", "pi-daemon.service"]);
	if (check.exitCode !== 0) {
		log.warn("pi-daemon.service failed to start after setup completion", {
			stdout: check.stdout.trim(),
			stderr: check.stderr.trim(),
		});
	} else {
		log.info("enabled pi-daemon.service and linger for persistent Matrix listening");
	}
}

/** Check if setup is already complete (sentinel file exists). */
export function isSetupDone(): boolean {
	return existsSync(SETUP_COMPLETE_PATH);
}

/** Handle setup_status tool call. */
export function handleSetupStatus() {
	const state = loadState();
	const next = getNextStep(state);
	const summary = getStepsSummary(state);
	const complete = isSetupComplete(state);

	const lines: string[] = [];
	lines.push(complete ? "Setup is complete." : `Setup in progress. Next step: **${next}**`);
	lines.push("");
	for (const s of summary) {
		const icon = s.status === "completed" ? "[x]" : s.status === "skipped" ? "[-]" : "[ ]";
		lines.push(`${icon} ${s.name}`);
	}

	if (next && !complete) {
		lines.push("");
		lines.push(`## Guidance for "${next}"`);
		lines.push(STEP_GUIDANCE[next]);
	}

	return {
		content: [{ type: "text" as const, text: lines.join("\n") }],
		details: { nextStep: next, complete, summary },
	};
}

/** Handle setup_advance tool call. */
export async function handleSetupAdvance(params: { step: StepName; result: "completed" | "skipped"; reason?: string }) {
	let state = loadState();
	const { step, result } = params;
	state = advanceStep(state, step, result, params.reason);
	saveState(state);

	if (isSetupComplete(state)) {
		await touchSetupComplete();
		return {
			content: [
				{
					type: "text" as const,
					text: "Setup complete! All steps finished. The setup wizard will not run on next login.",
				},
			],
			details: {},
		};
	}

	const next = getNextStep(state);
	const lines: string[] = [];
	lines.push(`Step "${step}" marked as ${result}.`);
	if (next) {
		lines.push(`Next step: **${next}**`);
		lines.push("");
		lines.push(`## Guidance for "${next}"`);
		lines.push(STEP_GUIDANCE[next]);
	}

	return {
		content: [{ type: "text" as const, text: lines.join("\n") }],
		details: {},
	};
}

/** Handle setup_reset tool call. */
export function handleSetupReset(params: { step?: StepName }) {
	if (params.step) {
		const state = loadState();
		state.steps[params.step] = { status: "pending" };
		state.completedAt = null;
		saveState(state);
		return {
			content: [{ type: "text" as const, text: `Step "${params.step}" reset to pending.` }],
			details: {} as Record<string, unknown>,
		};
	}

	// Full reset
	const state = createInitialState();
	saveState(state);
	return {
		content: [{ type: "text" as const, text: "Full setup reset. All steps are pending." }],
		details: {} as Record<string, unknown>,
	};
}

/** Generate the system prompt injection for the first-boot skill. */
export function getSetupSystemPrompt(): string {
	const state = loadState();
	const next = getNextStep(state);
	if (!next) return "";

	const lines: string[] = [];
	lines.push("# First-Boot Setup Wizard");
	lines.push("");
	lines.push("You are guiding the user through first-time setup. This is their first experience with Bloom.");
	lines.push("Be warm, conversational, and guide one step at a time. Never overwhelm.");
	lines.push('The user can say "skip" at any step.');
	lines.push("");
	lines.push("## Current Progress");
	for (const s of getStepsSummary(state)) {
		const icon = s.status === "completed" ? "[x]" : s.status === "skipped" ? "[-]" : "[ ]";
		lines.push(`${icon} ${s.name}`);
	}
	lines.push("");
	lines.push(`## Current Step: ${next}`);
	lines.push(STEP_GUIDANCE[next]);
	lines.push("");
	lines.push("After completing each step, call setup_advance(step, result) to record progress and get the next step.");
	lines.push("If the user wants to skip, call setup_advance(step, 'skipped', reason).");
	lines.push("Call setup_status() at any time to check progress.");

	return lines.join("\n");
}
