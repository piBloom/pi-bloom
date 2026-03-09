/**
 * bloom-os — OS management: bootc lifecycle, containers, systemd, health, updates.
 *
 * @tools bootc, container, systemd_control, system_health, update_status, schedule_reboot
 * @hooks before_agent_start
 * @see {@link ../../AGENTS.md#bloom-os} Extension reference
 */
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { errorResult, guardBloom } from "../../lib/shared.js";
import {
	checkPendingUpdates,
	handleBootc,
	handleContainerDeploy,
	handleContainerLogs,
	handleContainerStatus,
	handleScheduleReboot,
	handleSystemdControl,
	handleSystemHealth,
	handleUpdateStatus,
} from "./actions.js";

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "bootc",
		label: "Bootc Management",
		description: "Manage Fedora bootc OS image: status, check/download/apply updates, or rollback.",
		parameters: Type.Object({
			action: StringEnum(["status", "check", "download", "apply", "rollback"] as const, {
				description:
					"status: show image. check/download/apply: staged update workflow. rollback: revert to previous image.",
			}),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			return handleBootc(params.action, signal, ctx);
		},
	});

	pi.registerTool({
		name: "container",
		label: "Container Management",
		description: "Manage Bloom containers: list status, view logs, or deploy a Quadlet unit.",
		parameters: Type.Object({
			action: StringEnum(["status", "logs", "deploy"] as const, {
				description: "status: list running bloom-* containers. logs: view service logs. deploy: start a Quadlet unit.",
			}),
			service: Type.Optional(
				Type.String({ description: "Service name, required for logs/deploy (e.g. bloom-element)" }),
			),
			lines: Type.Optional(Type.Number({ description: "Log lines to return (default 50)", default: 50 })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const { action, service } = params;

			if (action === "status") {
				return handleContainerStatus(signal);
			}

			if (!service) {
				return errorResult(`The "${action}" action requires a service name.`);
			}
			const guard = guardBloom(service);
			if (guard) return errorResult(guard);

			if (action === "logs") {
				return handleContainerLogs(service, params.lines ?? 50, signal);
			}

			return handleContainerDeploy(service, signal, ctx);
		},
	});

	pi.registerTool({
		name: "systemd_control",
		label: "Systemd Service Control",
		description: "Manage a Bloom user-systemd service (start, stop, restart, status). Only bloom-* services allowed.",
		parameters: Type.Object({
			service: Type.String({ description: "Service name (e.g. bloom-element)" }),
			action: StringEnum(["start", "stop", "restart", "status"] as const),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			return handleSystemdControl(params.service, params.action, signal, ctx);
		},
	});

	pi.registerTool({
		name: "update_status",
		label: "Update Status",
		description: "Reads the Bloom OS update status from the last scheduled check.",
		parameters: Type.Object({}),
		async execute() {
			return handleUpdateStatus();
		},
	});

	pi.registerTool({
		name: "schedule_reboot",
		label: "Schedule Reboot",
		description: "Schedule a system reboot after a delay (in minutes). Requires user confirmation.",
		parameters: Type.Object({
			delay_minutes: Type.Number({ description: "Minutes to wait before rebooting", default: 1 }),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			return handleScheduleReboot(params.delay_minutes, signal, ctx);
		},
	});

	pi.registerTool({
		name: "system_health",
		label: "System Health",
		description: "Composite health check: OS image status, containers, disk usage, system load, and memory.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, signal) {
			return handleSystemHealth(signal);
		},
	});

	pi.on("before_agent_start", async (event) => {
		return checkPendingUpdates(event.systemPrompt);
	});
}
