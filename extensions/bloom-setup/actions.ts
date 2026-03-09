/**
 * Handler / business logic for bloom-setup.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import {
	advanceStep,
	createInitialState,
	getNextStep,
	getStepsSummary,
	isSetupComplete,
	type SetupState,
	STEP_ORDER,
	type StepName,
} from "../../lib/setup.js";
import { createLogger, errorResult } from "../../lib/shared.js";

const log = createLogger("bloom-setup");

const SETUP_STATE_PATH = join(os.homedir(), ".bloom", "setup-state.json");
const SETUP_COMPLETE_PATH = join(os.homedir(), ".bloom", ".setup-complete");

/** Step guidance — what Pi should say/do at each step. */
export const STEP_GUIDANCE: Record<StepName, string> = {
	welcome:
		"Introduce Bloom to the user. Explain: Bloom is their personal AI companion OS. Pi (you) is the AI agent that lives here. Bloom can self-evolve — the user can teach you new skills, install services, and customize your persona. Keep it to 2-3 short messages, warm and conversational. Don't overwhelm.",
	network:
		"Check network connectivity by running: nmcli general status. If connected, confirm and move on. If not, scan for WiFi with: nmcli device wifi list, show the results, ask the user to pick a network, then connect with: nmcli device wifi connect <SSID> password <password>. Retry if it fails.",
	netbird:
		"Explain that NetBird creates a private mesh network so the user can access this device from anywhere. Ask for their NetBird setup key. Run: sudo netbird up --setup-key <KEY>. Check status with: netbird status. Show the assigned mesh IP.",
	connectivity:
		"Summarize how to connect: (1) Locally at localhost if sitting at the device, (2) Via NetBird mesh IP from any peer device. Show the mesh IP from: netbird status. Mention SSH: ssh pi@<mesh-ip>.",
	webdav:
		"Ask if the user wants a file server. Explain: dufs (WebDAV) lets you access your files from any device via a web browser or file manager. If yes, use service_install(name='dufs') to install it.",
	channels:
		"Ask: 'Would you like to connect a messaging channel? Matrix is the default — it gives you a private homeserver.' If yes, use service_install(name='matrix') then service_install(name='element') then service_pair(name='element') to get connection details.",
	local_ai:
		'Ask: \'Want to enable optional local AI capabilities? These run on-device for free:\' List: (1) Voice transcription (Whisper-Small) — transcribe voice messages, (2) Image generation (SD-Turbo) — generate images about your state, (3) Voice responses (Kokoro-v1) — I can speak back to you. For each one the user wants, pull the model via the lemonade API: POST http://localhost:8000/api/v1/pull with body {"model": "<model-name>", "stream": true}. The LLM (Qwen3-4B) was already pulled during first-boot.',
	llm_upgrade:
		"Explain: 'You're running on a local Qwen3-4B model via lemonade-server right now. For much better reasoning, let's connect a cloud AI provider.' Guide them step by step: (1) Run /login to sign in via OAuth to Anthropic, OpenAI, or Google. (2) Once logged in, run /model to pick a stronger model (recommend Claude Sonnet or GPT-4o). (3) If the user prefers API keys instead, help them set the environment variable. (4) If they want to stay local-only, that's fine — skip.",
	git_identity:
		"Ask for the user's name and email for git commits. Run: git config --global user.name '<name>' and git config --global user.email '<email>'. Confirm the settings.",
	contributing:
		"Developer tools let you contribute to Bloom from this device:\n- **code-server**: Edit code in a web browser\n- **Local OS builds**: Rebuild and test the OS image without waiting for CI\n- **Upstream contributions**: Push skills, services, and extensions as PRs\n\nAsk the user: \"Would you like to enable developer tools? You can always enable them later with dev_enable.\"\n\nIf yes: Call dev_enable to activate dev mode, then guide through bloom_repo(action: 'configure') if not already done.\nIf no: Acknowledge and move on. Mention they can run dev_enable anytime.",
	persona:
		"Guide the user through personalizing their AI companion. Ask one question at a time: SOUL — 'What should I call you?', 'How formal or casual should I be?', 'Any values important to you?'. BODY — 'Short messages on mobile, longer on terminal?'. FACULTY — 'Step-by-step thinker or quick and direct?'. Update ~/Bloom/Persona/ files with their preferences. Fully skippable.",
	test_message:
		"If a messaging channel (Matrix) was set up, send a test message: 'Hi. Can you hear me?' using the channel. If no channel was set up, skip this step.",
	complete:
		"Congratulate the user! Setup is complete. Mention they can chat here on the terminal or on their connected messaging channel. Remind them they can revisit any setup step by asking.",
};

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

/** Mark setup as complete by touching the sentinel file. */
export function touchSetupComplete(): void {
	const dir = dirname(SETUP_COMPLETE_PATH);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
	writeFileSync(SETUP_COMPLETE_PATH, new Date().toISOString(), "utf-8");
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
export function handleSetupAdvance(params: { step: string; result: string; reason?: string }) {
	const step = params.step as StepName;
	if (!STEP_ORDER.includes(step)) {
		return errorResult(`Unknown step: ${step}. Valid steps: ${STEP_ORDER.join(", ")}`);
	}

	const result = params.result as "completed" | "skipped";
	if (result !== "completed" && result !== "skipped") {
		return errorResult(`Result must be "completed" or "skipped", got: ${result}`);
	}

	let state = loadState();
	state = advanceStep(state, step, result, params.reason);
	saveState(state);

	if (isSetupComplete(state)) {
		touchSetupComplete();
		return {
			content: [
				{
					type: "text" as const,
					text: "Setup complete! All steps finished. The setup wizard will not run on next login.",
				},
			],
			details: { complete: true },
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
		details: { nextStep: next, complete: false },
	};
}

/** Handle setup_reset tool call. */
export function handleSetupReset(params: { step?: string }) {
	if (params.step) {
		const step = params.step as StepName;
		if (!STEP_ORDER.includes(step)) {
			return errorResult(`Unknown step: ${step}. Valid steps: ${STEP_ORDER.join(", ")}`);
		}
		const state = loadState();
		state.steps[step] = { status: "pending" };
		state.completedAt = null;
		saveState(state);
		return {
			content: [{ type: "text" as const, text: `Step "${step}" reset to pending.` }],
			details: { step },
		};
	}

	// Full reset
	const state = createInitialState();
	saveState(state);
	return {
		content: [{ type: "text" as const, text: "Full setup reset. All steps are pending." }],
		details: { fullReset: true },
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
