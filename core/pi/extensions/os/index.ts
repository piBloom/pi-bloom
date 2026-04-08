/**
 * os — OS management: NixOS lifecycle, systemd, health, and updates.
 *
 * @tools nixos_update, nix_config_proposal, systemd_control, system_health, update_status, schedule_reboot
 * @hooks before_agent_start
 * @see {@link ../../AGENTS.md#os} Extension reference
 */
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { type Static, Type } from "@sinclair/typebox";
import { EmptyToolParams, type RegisteredExtensionTool, registerTools } from "../../../lib/utils.js";
import {
	checkPendingUpdates,
	handleNixosUpdate,
	handleScheduleReboot,
	handleSystemdControl,
	handleUpdateStatus,
} from "./actions.js";
import { handleSystemHealth } from "./actions-health.js";
import { handleNixConfigProposal } from "./actions-proposal.js";

const NixosUpdateParams = Type.Object({
	action: StringEnum(["status", "apply", "rollback"] as const, {
		description:
			"status: list NixOS generations. apply: run nixos-rebuild switch from the local NixPI flake checkout. rollback: revert to previous generation.",
	}),
});

const NixConfigProposalParams = Type.Object({
	action: StringEnum(["status", "validate", "update_flake_lock"] as const, {
		description:
			"status: inspect the local proposal repo and Nix-related diff. validate: run local flake and config checks. update_flake_lock: refresh flake.lock in the local repo.",
	}),
});

const SystemdControlParams = Type.Object({
	service: Type.String({ description: "Service name (e.g. nixpi-ttyd)" }),
	action: StringEnum(["start", "stop", "restart", "status"] as const),
});

const UpdateStatusParams = EmptyToolParams;

const ScheduleRebootParams = Type.Object({
	delay_minutes: Type.Number({ description: "Minutes to wait before rebooting", default: 1 }),
});

const SystemHealthParams = EmptyToolParams;

export default function (pi: ExtensionAPI) {
	const tools: RegisteredExtensionTool[] = [
		{
			name: "nixos_update",
			label: "NixOS Update Management",
			description:
				"Manage NixOS OS updates: view generation history, apply the local NixPI flake checkout, or rollback to the previous generation.",
			parameters: NixosUpdateParams,
			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				const p = params as Static<typeof NixosUpdateParams>;
				return handleNixosUpdate(p.action, signal, ctx);
			},
		},
		{
			name: "nix_config_proposal",
			label: "Local Nix Config Proposal",
			description:
				"Inspect, validate, and refresh flake inputs in the local NixPI repo clone used for human-reviewed NixOS proposals. Does not apply system changes or publish remotely.",
			parameters: NixConfigProposalParams,
			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				const p = params as Static<typeof NixConfigProposalParams>;
				return handleNixConfigProposal(p.action, signal, ctx);
			},
		},
		{
			name: "systemd_control",
			label: "Systemd Service Control",
			description: "Manage a NixPI user-systemd service (start, stop, restart, status). Only nixpi-* services allowed.",
			parameters: SystemdControlParams,
			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				const p = params as Static<typeof SystemdControlParams>;
				return handleSystemdControl(p.service, p.action, signal, ctx);
			},
		},
		{
			name: "update_status",
			label: "Update Status",
			description: "Reads the NixPI update status from the last scheduled check.",
			parameters: UpdateStatusParams,
			async execute() {
				return handleUpdateStatus();
			},
		},
		{
			name: "schedule_reboot",
			label: "Schedule Reboot",
			description: "Schedule a system reboot after a delay (in minutes). Requires user confirmation.",
			parameters: ScheduleRebootParams,
			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				const p = params as Static<typeof ScheduleRebootParams>;
				return handleScheduleReboot(p.delay_minutes, signal, ctx);
			},
		},
		{
			name: "system_health",
			label: "System Health",
			description: "Composite health check: OS image status, containers, disk usage, system load, and memory.",
			parameters: SystemHealthParams,
			async execute(_toolCallId, _params, signal) {
				return handleSystemHealth(signal);
			},
		},
	];
	registerTools(pi, tools);

	let updateChecked = false;

	pi.on("before_agent_start", async (event) => {
		if (updateChecked) return;
		updateChecked = true;
		return checkPendingUpdates(event.systemPrompt);
	});
}
