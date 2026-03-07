/**
 * 💻 bloom-os — OS management: bootc lifecycle, containers, systemd, health, updates.
 *
 * @tools bootc_status, bootc_update, bootc_rollback, container_status, container_logs, container_deploy, systemd_control, system_health, update_status, schedule_reboot
 * @hooks before_agent_start
 * @see {@link ../AGENTS.md#bloom-os} Extension reference
 */
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { run } from "../lib/exec.js";
import { errorResult, guardBloom, requireConfirmation, truncate } from "../lib/shared.js";

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "bootc_status",
		label: "OS Image Status",
		description: "Shows the current Fedora bootc OS image status, pending updates, and rollback availability.",
		promptSnippet: "bootc_status — show OS image version and update status",
		promptGuidelines: ["Use bootc_status when the user asks about OS version, update status, or system health"],
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, signal, _onUpdate, _ctx) {
			const result = await run("bootc", ["status"], signal);
			const text = truncate(result.exitCode === 0 ? result.stdout : `Error running bootc status:\n${result.stderr}`);
			return {
				content: [{ type: "text", text }],
				details: { exitCode: result.exitCode },
				isError: result.exitCode !== 0,
			};
		},
	});

	pi.registerTool({
		name: "bootc_update",
		label: "OS Update",
		description: "Check for, download, or apply a Fedora bootc OS update using a staged workflow.",
		promptSnippet: "bootc_update — check, download, or apply OS updates",
		promptGuidelines: [
			"Use bootc_update with stage='check' first, then 'download' to fetch, then 'apply' to stage for reboot.",
			"The 'download' and 'apply' stages require user confirmation.",
		],
		parameters: Type.Object({
			stage: Type.Optional(
				StringEnum(["check", "download", "apply"] as const, {
					description: "Update stage: check (default), download (fetch only), apply (stage for reboot)",
					default: "check",
				}),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const stage = params.stage ?? "check";
			if (stage !== "check") {
				const denied = await requireConfirmation(ctx, `OS update: ${stage}`);
				if (denied) return errorResult(denied);
			}
			let cmd: string;
			let fullArgs: string[];
			switch (stage) {
				case "check":
					cmd = "bootc";
					fullArgs = ["upgrade", "--check"];
					break;
				case "download":
					cmd = "sudo";
					fullArgs = ["bootc", "upgrade"];
					break;
				case "apply":
					cmd = "sudo";
					fullArgs = ["bootc", "upgrade", "--apply"];
					break;
			}
			const result = await run(cmd, fullArgs, signal);
			const text = truncate(result.exitCode === 0 ? result.stdout || "No output." : `Error:\n${result.stderr}`);
			return {
				content: [{ type: "text", text }],
				details: { exitCode: result.exitCode, stage },
				isError: result.exitCode !== 0,
			};
		},
	});

	pi.registerTool({
		name: "bootc_rollback",
		label: "OS Rollback",
		description: "Rollback to the previous Fedora bootc OS image. Requires reboot to take effect.",
		promptSnippet: "bootc_rollback — rollback to previous OS image",
		promptGuidelines: [
			"Use bootc_rollback to revert to the previous OS image after a failed update.",
			"Requires user confirmation. Takes effect on next reboot.",
		],
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, signal, _onUpdate, ctx) {
			const denied = await requireConfirmation(ctx, "Rollback to previous OS image via bootc rollback");
			if (denied) return errorResult(denied);
			const result = await run("sudo", ["bootc", "rollback"], signal);
			const text = truncate(
				result.exitCode === 0 ? result.stdout || "Rollback staged. Reboot to apply." : `Error:\n${result.stderr}`,
			);
			return {
				content: [{ type: "text", text }],
				details: { exitCode: result.exitCode },
				isError: result.exitCode !== 0,
			};
		},
	});

	pi.registerTool({
		name: "container_status",
		label: "Container Status",
		description: "Lists running Bloom containers and their health status.",
		promptSnippet: "container_status — list running bloom-* containers",
		promptGuidelines: ["Use container_status to check running Bloom containers and their health"],
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, signal, _onUpdate, _ctx) {
			const result = await run("podman", ["ps", "--format", "json", "--filter", "name=bloom-"], signal);
			if (result.exitCode !== 0) {
				return errorResult(`Error listing containers:\n${result.stderr}`);
			}
			let text: string;
			try {
				const containers = JSON.parse(result.stdout || "[]") as Array<{
					Names?: string[];
					Status?: string;
					State?: string;
					Image?: string;
				}>;
				if (containers.length === 0) {
					text = "No bloom-* containers are currently running.";
				} else {
					text = containers
						.map((c) => {
							const name = (c.Names ?? []).join(", ") || "unknown";
							const status = c.Status ?? c.State ?? "unknown";
							const image = c.Image ?? "unknown";
							return `${name}\n  status: ${status}\n  image:  ${image}`;
						})
						.join("\n\n");
				}
			} catch {
				text = result.stdout;
			}
			return { content: [{ type: "text", text: truncate(text) }], details: {} };
		},
	});

	pi.registerTool({
		name: "container_logs",
		label: "Container Logs",
		description: "Fetches recent journald logs for a Bloom service.",
		promptSnippet: "container_logs — tail logs for a bloom-* service",
		promptGuidelines: [
			"Use container_logs to check recent logs for a Bloom service. Only bloom-* services are accessible.",
		],
		parameters: Type.Object({
			service: Type.String({ description: "Service name (e.g. bloom-whatsapp)" }),
			lines: Type.Optional(Type.Number({ description: "Number of log lines to return", default: 50 })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			const guard = guardBloom(params.service);
			if (guard) return errorResult(guard);
			const n = String(params.lines ?? 50);
			const unit = `${params.service}.service`;
			const result = await run("journalctl", ["--user", "-u", unit, "--no-pager", "-n", n], signal);
			const text = truncate(
				result.exitCode === 0 ? result.stdout || "(no log output)" : `Error fetching logs:\n${result.stderr}`,
			);
			return {
				content: [{ type: "text", text }],
				details: { exitCode: result.exitCode },
				isError: result.exitCode !== 0,
			};
		},
	});

	pi.registerTool({
		name: "systemd_control",
		label: "Systemd Service Control",
		description: "Manage a Bloom user-systemd service (start, stop, restart, status).",
		promptSnippet: "systemd_control — start/stop/restart/status a bloom-* service",
		promptGuidelines: [
			"Use systemd_control to manage Bloom user-systemd services. Only bloom-* services can be controlled.",
			"Use status for read-only checks; other actions require justification.",
		],
		parameters: Type.Object({
			service: Type.String({ description: "Service name (e.g. bloom-whatsapp)" }),
			action: StringEnum(["start", "stop", "restart", "status"] as const),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const guard = guardBloom(params.service);
			if (guard) return errorResult(guard);
			const unit = `${params.service}.service`;
			const readOnly = params.action === "status";
			if (!readOnly) {
				const denied = await requireConfirmation(ctx, `systemctl ${params.action} ${unit}`);
				if (denied) return errorResult(denied);
			}
			const result = await run("systemctl", ["--user", params.action, unit], signal);
			const text = truncate(result.stdout || result.stderr || `systemctl --user ${params.action} ${unit} completed.`);
			return {
				content: [{ type: "text", text }],
				details: { exitCode: result.exitCode },
				isError: result.exitCode !== 0,
			};
		},
	});

	pi.registerTool({
		name: "container_deploy",
		label: "Deploy Container",
		description: "Reload user systemd and start a Bloom Quadlet unit.",
		promptSnippet: "container_deploy — deploy a bloom-* Quadlet container unit",
		promptGuidelines: [
			"Use container_deploy to start a new container from an existing Quadlet unit file. Only bloom-* units can be deployed.",
		],
		parameters: Type.Object({
			quadlet_name: Type.String({ description: "Name of the Quadlet unit to deploy (e.g. bloom-web)" }),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const guard = guardBloom(params.quadlet_name);
			if (guard) return errorResult(guard);
			const unit = `${params.quadlet_name}.service`;
			const denied = await requireConfirmation(ctx, `Deploy container ${unit}`);
			if (denied) return errorResult(denied);
			const reload = await run("systemctl", ["--user", "daemon-reload"], signal);
			if (reload.exitCode !== 0) {
				return errorResult(`systemctl --user daemon-reload failed:\n${reload.stderr}`);
			}
			const start = await run("systemctl", ["--user", "start", unit], signal);
			const text = truncate(
				start.exitCode === 0 ? `Started ${unit} successfully.` : `Failed to start ${unit}:\n${start.stderr}`,
			);
			return {
				content: [{ type: "text", text }],
				details: { exitCode: start.exitCode },
				isError: start.exitCode !== 0,
			};
		},
	});

	// --- Update detection tools ---

	const bloomDir = join(os.homedir(), ".bloom");
	const statusFile = join(bloomDir, "update-status.json");

	pi.registerTool({
		name: "update_status",
		label: "Update Status",
		description: "Reads the Bloom OS update status from the last scheduled check.",
		promptSnippet: "update_status — check if an OS update is available",
		promptGuidelines: ["Use update_status to check whether a new OS image is available before suggesting an upgrade."],
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
			try {
				const raw = await readFile(statusFile, "utf-8");
				const status = JSON.parse(raw);
				const text = status.available
					? `Update available (checked ${status.checked}). Version: ${status.version || "unknown"}`
					: `System is up to date (checked ${status.checked}).`;
				return { content: [{ type: "text", text }], details: status };
			} catch {
				return errorResult("No update status available. The update check timer may not have run yet.");
			}
		},
	});

	pi.registerTool({
		name: "schedule_reboot",
		label: "Schedule Reboot",
		description: "Schedule a system reboot after a delay (in minutes). Requires user confirmation.",
		promptSnippet: "schedule_reboot — schedule a delayed system reboot",
		promptGuidelines: [
			"ALWAYS ask for explicit user confirmation before calling schedule_reboot.",
			"Use after staging an OS update to apply it.",
		],
		parameters: Type.Object({
			delay_minutes: Type.Number({ description: "Minutes to wait before rebooting", default: 1 }),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const delay = Math.max(1, Math.round(params.delay_minutes));
			const denied = await requireConfirmation(ctx, `Schedule reboot in ${delay} minute(s)`);
			if (denied) return errorResult(denied);
			const result = await run("sudo", ["systemd-run", `--on-active=${delay}m`, "systemctl", "reboot"], signal);
			if (result.exitCode !== 0) {
				return errorResult(`Failed to schedule reboot:\n${result.stderr}`);
			}
			return {
				content: [{ type: "text", text: `Reboot scheduled in ${delay} minute(s).` }],
				details: { delay_minutes: delay },
			};
		},
	});

	pi.registerTool({
		name: "system_health",
		label: "System Health",
		description: "Composite health check: OS image status, containers, disk usage, system load, and memory.",
		promptSnippet: "system_health — comprehensive system health overview",
		promptGuidelines: [
			"Use system_health for a quick overview of the entire system.",
			"Run proactively at session start or when the user asks about system health.",
		],
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, signal, _onUpdate, _ctx) {
			const sections: string[] = [];

			const bootc = await run("bootc", ["status", "--format=json"], signal);
			if (bootc.exitCode === 0) {
				try {
					const status = JSON.parse(bootc.stdout) as {
						status?: { booted?: { image?: { image?: { image?: string; version?: string } } } };
					};
					const img = status?.status?.booted?.image?.image;
					sections.push(`## OS Image\n- Image: ${img?.image ?? "unknown"}\n- Version: ${img?.version ?? "unknown"}`);
				} catch {
					sections.push(`## OS Image\n${bootc.stdout.slice(0, 200)}`);
				}
			} else {
				sections.push("## OS Image\n(bootc status unavailable)");
			}

			const ps = await run("podman", ["ps", "--format", "json", "--filter", "name=bloom-"], signal);
			if (ps.exitCode === 0) {
				try {
					const containers = JSON.parse(ps.stdout || "[]") as Array<{
						Names?: string[];
						Status?: string;
						State?: string;
					}>;
					if (containers.length === 0) {
						sections.push("## Containers\nNo bloom-* containers running.");
					} else {
						const lines = containers.map((c) => {
							const name = (c.Names ?? []).join(", ") || "unknown";
							return `- ${name}: ${c.Status ?? c.State ?? "unknown"}`;
						});
						sections.push(`## Containers\n${lines.join("\n")}`);
					}
				} catch {
					sections.push("## Containers\n(parse error)");
				}
			}

			const df = await run("df", ["-h", "/", "/var", "/home"], signal);
			if (df.exitCode === 0) {
				sections.push(`## Disk Usage\n\`\`\`\n${df.stdout.trim()}\n\`\`\``);
			}

			const loadavg = await run("cat", ["/proc/loadavg"], signal);
			const meminfo = await run("free", ["-h", "--si"], signal);
			const uptime = await run("uptime", ["-p"], signal);

			const loadParts: string[] = [];
			if (loadavg.exitCode === 0) {
				const parts = loadavg.stdout.trim().split(/\s+/);
				loadParts.push(`Load: ${parts.slice(0, 3).join(" ")}`);
			}
			if (uptime.exitCode === 0) {
				loadParts.push(`Uptime: ${uptime.stdout.trim()}`);
			}
			if (meminfo.exitCode === 0) {
				const memLine = meminfo.stdout.split("\n").find((l) => l.startsWith("Mem:"));
				if (memLine) {
					const cols = memLine.split(/\s+/);
					loadParts.push(`Memory: ${cols[2] ?? "?"} used / ${cols[1] ?? "?"} total`);
				}
			}
			if (loadParts.length > 0) {
				sections.push(`## System\n${loadParts.map((l) => `- ${l}`).join("\n")}`);
			}

			const text = sections.join("\n\n");
			return { content: [{ type: "text", text: truncate(text) }], details: {} };
		},
	});

	// --- Session-start hook: notify about pending updates ---

	let updateChecked = false;

	pi.on("before_agent_start", async (event) => {
		if (updateChecked) return;
		updateChecked = true;
		try {
			const raw = await readFile(statusFile, "utf-8");
			const status = JSON.parse(raw);
			if (status.available && !status.notified) {
				status.notified = true;
				await writeFile(statusFile, JSON.stringify(status), "utf-8");
				const note =
					"\n\n[SYSTEM] A Bloom OS update is available. " +
					"Inform the user and ask if they'd like to review and apply it.";
				return { systemPrompt: event.systemPrompt + note };
			}
		} catch {
			// No status file yet — timer hasn't run
		}
	});
}
