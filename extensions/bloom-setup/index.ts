/**
 * bloom-setup — First-boot setup wizard: guides user through 14 setup steps.
 *
 * @tools setup_status, setup_advance, setup_reset
 * @hooks before_agent_start
 */
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { STEP_ORDER } from "../../lib/setup.js";
import {
	getSetupSystemPrompt,
	handleSetupAdvance,
	handleSetupReset,
	handleSetupStatus,
	isSetupDone,
} from "./actions.js";

export default function (pi: ExtensionAPI) {
	// Register local LLM provider (bundled Crow-4B Opus distill via llama.cpp)
	pi.registerProvider("bloom-local", {
		baseUrl: "http://localhost:8080/v1",
		apiKey: "local",
		api: "openai-completions",
		models: [
			{
				id: "crow-4b",
				name: "Crow 4B (local, Opus distill)",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 131072,
				maxTokens: 8192,
			},
		],
	});

	pi.registerTool({
		name: "setup_status",
		label: "Setup Status",
		description:
			"Show current first-boot setup progress: which steps are complete, skipped, or pending, and guidance for the next step.",
		parameters: Type.Object({}),
		async execute() {
			return handleSetupStatus();
		},
	});

	pi.registerTool({
		name: "setup_advance",
		label: "Advance Setup Step",
		description: "Mark a setup step as completed or skipped, persist state, and return guidance for the next step.",
		parameters: Type.Object({
			step: StringEnum([...STEP_ORDER], {
				description: "The setup step to advance",
			}),
			result: StringEnum(["completed", "skipped"] as const, {
				description: "Whether the step was completed or skipped",
			}),
			reason: Type.Optional(Type.String({ description: "Reason for skipping (required when result is 'skipped')" })),
		}),
		async execute(_toolCallId, params) {
			return handleSetupAdvance(params);
		},
	});

	pi.registerTool({
		name: "setup_reset",
		label: "Reset Setup Step",
		description:
			"Reset a specific setup step to pending, or reset the entire setup. Useful if the user wants to redo a step.",
		parameters: Type.Object({
			step: Type.Optional(
				StringEnum([...STEP_ORDER], {
					description: "Step to reset (omit for full reset)",
				}),
			),
		}),
		async execute(_toolCallId, params) {
			return handleSetupReset(params);
		},
	});

	// Inject first-boot skill into system prompt when setup is incomplete
	pi.on("before_agent_start", async (event) => {
		if (isSetupDone()) return;

		const setupPrompt = getSetupSystemPrompt();
		if (setupPrompt) {
			return { systemPrompt: `${setupPrompt}\n\n${event.systemPrompt}` };
		}
	});
}
