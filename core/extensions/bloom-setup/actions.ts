/**
 * Handler / business logic for bloom-setup.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { atomicWriteFile, ensureDir } from "../../lib/fs-utils.js";
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
	atomicWriteFile(SETUP_STATE_PATH, JSON.stringify(state, null, 2), 0o700);
}

/** Mark persona customization as complete (wizard already handled OS-level setup). */
export async function touchPersonaDone(): Promise<void> {
	const markerPath = join(os.homedir(), ".bloom", "wizard-state", "persona-done");
	const dir = dirname(markerPath);
	if (!existsSync(dir)) ensureDir(dir, 0o700);
	writeFileSync(markerPath, new Date().toISOString(), "utf-8");
	log.info("persona customization complete");
}

/** Check if setup is already complete (sentinel file exists). */
export function isSetupDone(): boolean {
	return existsSync(SETUP_COMPLETE_PATH);
}

/** Handle setup_status tool call. */
export function handleSetupStatus() {
	const emptySummary = getStepsSummary(createInitialState());
	if (!isSetupDone()) {
		return {
			content: [
				{
					type: "text" as const,
					text: "Wizard setup is not complete yet. Finish `bloom-wizard.sh` first, then resume persona setup in Pi.",
				},
			],
			details: { complete: false, waitingForWizard: true, nextStep: null, summary: emptySummary },
		};
	}

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
		details: { nextStep: next, complete, summary, waitingForWizard: false },
	};
}

/** Handle setup_advance tool call. */
export async function handleSetupAdvance(params: { step: StepName; result: "completed" | "skipped"; reason?: string }) {
	let state = loadState();
	const { step, result } = params;
	state = advanceStep(state, step, result, params.reason);
	saveState(state);

	// Write persona-done marker as soon as persona step completes
	if (step === "persona") {
		await touchPersonaDone();
	}

	const next = getNextStep(state);
	const lines: string[] = [];
	lines.push(`Step "${step}" marked as ${result}.`);
	if (next) {
		lines.push(`Next step: **${next}**`);
		lines.push("");
		lines.push(`## Guidance for "${next}"`);
		lines.push(STEP_GUIDANCE[next]);
	} else {
		lines.push("All setup steps complete! Persona customization is done.");
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
	if (!isSetupDone()) return "";

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
