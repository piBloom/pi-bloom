/**
 * bloom-os — OS management: NixOS lifecycle, systemd, health, and updates.
 *
 * @tools nixos_update, nix_config_proposal, systemd_control, system_health, update_status, schedule_reboot
 * @hooks before_agent_start
 * @see {@link ../../AGENTS.md#bloom-os} Extension reference
 */
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { defineTool, type RegisteredExtensionTool, registerTools } from "../../lib/extension-tools.js";
import {
	checkPendingUpdates,
	handleNixosUpdate,
	handleScheduleReboot,
	handleSystemdControl,
	handleUpdateStatus,
} from "./actions.js";
import { handleSystemHealth } from "./actions-health.js";
import { handleNixConfigProposal } from "./actions-proposal.js";

export default function (pi: ExtensionAPI) {
	const tools: RegisteredExtensionTool[] = [
		defineTool({
			name: "nixos_update",
			label: "NixOS Update Management",
			description:
				"Manage NixOS OS updates: view generation history, apply from the remote or reviewed local flake, or rollback to the previous generation.",
			parameters: Type.Object({
				action: StringEnum(["status", "apply", "rollback"] as const, {
					description:
						"status: list NixOS generations. apply: run nixos-rebuild switch from the selected source. rollback: revert to previous generation.",
				}),
				source: StringEnum(["remote", "local"] as const, {
					description:
						"Which flake source to use for apply. remote uses the GitHub flake. local uses ~/.bloom/pi-bloom. Ignored for status and rollback.",
					default: "remote",
				}),
			}),
			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				const typedParams = params as { action: "status" | "apply" | "rollback"; source?: "remote" | "local" };
				return handleNixosUpdate(typedParams.action, typedParams.source ?? "remote", signal, ctx);
			},
		}),
		defineTool({
			name: "nix_config_proposal",
			label: "Local Nix Config Proposal",
			description:
				"Inspect, validate, and refresh flake inputs in the local Bloom repo clone used for human-reviewed NixOS proposals. Does not apply system changes or publish remotely.",
			parameters: Type.Object({
				action: StringEnum(["status", "validate", "update_flake_lock"] as const, {
					description:
						"status: inspect the local proposal repo and Nix-related diff. validate: run local flake and config checks. update_flake_lock: refresh flake.lock in the local repo.",
				}),
			}),
			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				const typedParams = params as { action: "status" | "validate" | "update_flake_lock" };
				return handleNixConfigProposal(typedParams.action, signal, ctx);
			},
		}),
		defineTool({
			name: "systemd_control",
			label: "Systemd Service Control",
			description: "Manage a Bloom user-systemd service (start, stop, restart, status). Only bloom-* services allowed.",
			parameters: Type.Object({
				service: Type.String({ description: "Service name (e.g. bloom-dufs)" }),
				action: StringEnum(["start", "stop", "restart", "status"] as const),
			}),
			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				const typedParams = params as { service: string; action: "start" | "stop" | "restart" | "status" };
				return handleSystemdControl(typedParams.service, typedParams.action, signal, ctx);
			},
		}),
		defineTool({
			name: "update_status",
			label: "Update Status",
			description: "Reads the Bloom OS update status from the last scheduled check.",
			parameters: Type.Object({}),
			async execute() {
				return handleUpdateStatus();
			},
		}),
		defineTool({
			name: "schedule_reboot",
			label: "Schedule Reboot",
			description: "Schedule a system reboot after a delay (in minutes). Requires user confirmation.",
			parameters: Type.Object({
				delay_minutes: Type.Number({ description: "Minutes to wait before rebooting", default: 1 }),
			}),
			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				const typedParams = params as { delay_minutes: number };
				return handleScheduleReboot(typedParams.delay_minutes, signal, ctx);
			},
		}),
		defineTool({
			name: "system_health",
			label: "System Health",
			description: "Composite health check: OS image status, containers, disk usage, system load, and memory.",
			parameters: Type.Object({}),
			async execute(_toolCallId, _params, signal) {
				return handleSystemHealth(signal);
			},
		}),
	];
	registerTools(pi, tools);

	let updateChecked = false;

	pi.on("before_agent_start", async (event) => {
		if (updateChecked) return;
		updateChecked = true;
		return checkPendingUpdates(event.systemPrompt);
	});
}
