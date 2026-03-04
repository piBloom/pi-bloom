import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { StringEnum } from "@mariozechner/pi-ai";
import { type ExtensionAPI, truncateHead } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const execAsync = promisify(execFile);

async function run(
	cmd: string,
	args: string[],
	signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	try {
		const { stdout, stderr } = await execAsync(cmd, args, { signal });
		return { stdout, stderr, exitCode: 0 };
	} catch (err: unknown) {
		const e = err as { message: string; stderr?: string; code?: number };
		return {
			stdout: "",
			stderr: e.stderr ?? e.message,
			exitCode: e.code ?? 1,
		};
	}
}

function guardBloom(name: string): string | null {
	if (!name.startsWith("bloom-")) {
		return `Security error: only bloom-* names are permitted, got "${name}"`;
	}
	return null;
}

function truncate(text: string): string {
	return truncateHead(text, { maxLines: 2000, maxBytes: 50000 }).content;
}

function errorResult(message: string) {
	return {
		content: [{ type: "text" as const, text: message }],
		details: {},
		isError: true,
	};
}

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
		description: "Check for or stage a Fedora bootc OS update. Staging does NOT reboot the system.",
		promptSnippet: "bootc_update — check or stage OS updates (no reboot)",
		promptGuidelines: [
			"Use bootc_update to check for or stage OS updates. Always check first.",
			"Staging requires user confirmation. Updates apply on next reboot.",
		],
		parameters: Type.Object({
			check_only: Type.Optional(
				Type.Boolean({ description: "If true, only check for updates without staging", default: true }),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			const checkOnly = params.check_only !== false;
			const args = checkOnly ? ["upgrade", "--check"] : ["upgrade"];
			const cmd = checkOnly ? "bootc" : "sudo";
			const fullArgs = checkOnly ? args : ["bootc", ...args];
			const result = await run(cmd, fullArgs, signal);
			const text = truncate(result.exitCode === 0 ? result.stdout || "No output." : `Error:\n${result.stderr}`);
			return {
				content: [{ type: "text", text }],
				details: { exitCode: result.exitCode, checkOnly },
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
			const result = await run("journalctl", ["-u", unit, "--no-pager", "-n", n], signal);
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
		description: "Manage a Bloom systemd service (start, stop, restart, status).",
		promptSnippet: "systemd_control — start/stop/restart/status a bloom-* service",
		promptGuidelines: [
			"Use systemd_control to manage Bloom systemd services. Only bloom-* services can be controlled.",
			"Use status for read-only checks; other actions require justification.",
		],
		parameters: Type.Object({
			service: Type.String({ description: "Service name (e.g. bloom-whatsapp)" }),
			action: StringEnum(["start", "stop", "restart", "status"] as const),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			const guard = guardBloom(params.service);
			if (guard) return errorResult(guard);
			const unit = `${params.service}.service`;
			const readOnly = params.action === "status";
			const cmd = readOnly ? "systemctl" : "sudo";
			const args = readOnly ? [params.action, unit] : ["systemctl", params.action, unit];
			const result = await run(cmd, args, signal);
			const text = truncate(result.stdout || result.stderr || `systemctl ${params.action} completed.`);
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
		description: "Reload systemd and start a Bloom Quadlet unit.",
		promptSnippet: "container_deploy — deploy a bloom-* Quadlet container unit",
		promptGuidelines: [
			"Use container_deploy to start a new container from an existing Quadlet unit file. Only bloom-* units can be deployed.",
		],
		parameters: Type.Object({
			quadlet_name: Type.String({ description: "Name of the Quadlet unit to deploy (e.g. bloom-web)" }),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			const guard = guardBloom(params.quadlet_name);
			if (guard) return errorResult(guard);
			const unit = `${params.quadlet_name}.service`;
			const reload = await run("sudo", ["systemctl", "daemon-reload"], signal);
			if (reload.exitCode !== 0) {
				return errorResult(`daemon-reload failed:\n${reload.stderr}`);
			}
			const start = await run("sudo", ["systemctl", "start", unit], signal);
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
}
