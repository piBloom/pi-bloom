/**
 * bloom-setup — Persona completion state after the first-boot wizard.
 *
 * @tools setup_status, setup_advance, setup_reset
 * @hooks before_agent_start
 */
import { existsSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { defineTool, type RegisteredExtensionTool, registerTools } from "../../lib/extension-tools.js";
import { STEP_ORDER } from "../../lib/setup.js";
import {
	getSetupSystemPrompt,
	handleSetupAdvance,
	handleSetupReset,
	handleSetupStatus,
	isSetupDone,
} from "./actions.js";

export default function (pi: ExtensionAPI) {
	const tools: RegisteredExtensionTool[] = [
		defineTool({
			name: "setup_status",
			label: "Setup Status",
			description:
				"Show current first-boot setup progress: which steps are complete, skipped, or pending, and guidance for the next step.",
			parameters: Type.Object({}),
			async execute() {
				return handleSetupStatus();
			},
		}),
		defineTool({
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
				return await handleSetupAdvance(
					params as { step: (typeof STEP_ORDER)[number]; result: "completed" | "skipped"; reason?: string },
				);
			},
		}),
		defineTool({
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
				return handleSetupReset(params as { step?: (typeof STEP_ORDER)[number] });
			},
		}),
	];
	registerTools(pi, tools);

	// Inject persona setup guidance after the wizard has completed.
	pi.on("before_agent_start", async (event) => {
		if (!isSetupDone()) return; // wizard hasn't run yet
		const personaDone = join(os.homedir(), ".bloom", "wizard-state", "persona-done");
		if (existsSync(personaDone)) return; // persona already done

		const setupPrompt = getSetupSystemPrompt();
		if (setupPrompt) {
			return { systemPrompt: `${setupPrompt}\n\n${event.systemPrompt}` };
		}
	});
}
