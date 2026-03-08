/**
 * Handler / business logic for bloom-os.
 */
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { run } from "../../lib/exec.js";
import { errorResult, guardBloom, requireConfirmation, truncate } from "../../lib/shared.js";
import type { ContainerInfo, UpdateStatus } from "./types.js";

const bloomDir = join(os.homedir(), ".bloom");
const statusFile = join(bloomDir, "update-status.json");

// --- Bootc handler ---

export async function handleBootc(
	action: "status" | "check" | "download" | "apply" | "rollback",
	signal: AbortSignal | undefined,
	ctx: ExtensionContext,
) {
	if (action === "download" || action === "apply" || action === "rollback") {
		const denied = await requireConfirmation(ctx, `OS ${action}`);
		if (denied) return errorResult(denied);
	}
	let cmd: string;
	let args: string[];
	switch (action) {
		case "status":
			cmd = "bootc";
			args = ["status"];
			break;
		case "check":
			cmd = "bootc";
			args = ["upgrade", "--check"];
			break;
		case "download":
			cmd = "sudo";
			args = ["bootc", "upgrade"];
			break;
		case "apply":
			cmd = "sudo";
			args = ["bootc", "upgrade", "--apply"];
			break;
		case "rollback":
			cmd = "sudo";
			args = ["bootc", "rollback"];
			break;
	}
	const result = await run(cmd, args, signal);
	let text: string;
	if (result.exitCode !== 0) {
		text = action === "status" ? `Error running bootc status:\n${result.stderr}` : `Error:\n${result.stderr}`;
	} else if (action === "rollback") {
		text = result.stdout || "Rollback staged. Reboot to apply.";
	} else {
		text = result.stdout || "No output.";
	}
	return {
		content: [{ type: "text" as const, text: truncate(text) }],
		details: { exitCode: result.exitCode, action },
		isError: result.exitCode !== 0,
	};
}

// --- Container handler ---

export async function handleContainerStatus(signal: AbortSignal | undefined) {
	const result = await run("podman", ["ps", "--format", "json", "--filter", "name=bloom-"], signal);
	if (result.exitCode !== 0) {
		return errorResult(`Error listing containers:\n${result.stderr}`);
	}
	let text: string;
	try {
		const containers = JSON.parse(result.stdout || "[]") as ContainerInfo[];
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
	return { content: [{ type: "text" as const, text: truncate(text) }], details: {} };
}

export async function handleContainerLogs(service: string, lines: number, signal: AbortSignal | undefined) {
	const n = String(lines);
	const unit = `${service}.service`;
	const result = await run("journalctl", ["--user", "-u", unit, "--no-pager", "-n", n], signal);
	const text = truncate(
		result.exitCode === 0 ? result.stdout || "(no log output)" : `Error fetching logs:\n${result.stderr}`,
	);
	return {
		content: [{ type: "text" as const, text }],
		details: { exitCode: result.exitCode },
		isError: result.exitCode !== 0,
	};
}

export async function handleContainerDeploy(service: string, signal: AbortSignal | undefined, ctx: ExtensionContext) {
	const unit = `${service}.service`;
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
		content: [{ type: "text" as const, text }],
		details: { exitCode: start.exitCode },
		isError: start.exitCode !== 0,
	};
}

// --- Systemd handler ---

export async function handleSystemdControl(
	service: string,
	action: "start" | "stop" | "restart" | "status",
	signal: AbortSignal | undefined,
	ctx: ExtensionContext,
) {
	const guard = guardBloom(service);
	if (guard) return errorResult(guard);
	const unit = `${service}.service`;
	const readOnly = action === "status";
	if (!readOnly) {
		const denied = await requireConfirmation(ctx, `systemctl ${action} ${unit}`);
		if (denied) return errorResult(denied);
	}
	const result = await run("systemctl", ["--user", action, unit], signal);
	const text = truncate(result.stdout || result.stderr || `systemctl --user ${action} ${unit} completed.`);
	return {
		content: [{ type: "text" as const, text }],
		details: { exitCode: result.exitCode },
		isError: result.exitCode !== 0,
	};
}

// --- Update status handler ---

export async function handleUpdateStatus() {
	try {
		const raw = await readFile(statusFile, "utf-8");
		const status = JSON.parse(raw) as UpdateStatus;
		const text = status.available
			? `Update available (checked ${status.checked}). Version: ${status.version || "unknown"}`
			: `System is up to date (checked ${status.checked}).`;
		return { content: [{ type: "text" as const, text }], details: status };
	} catch {
		return errorResult("No update status available. The update check timer may not have run yet.");
	}
}

// --- Schedule reboot handler ---

export async function handleScheduleReboot(
	delayMinutes: number,
	signal: AbortSignal | undefined,
	ctx: ExtensionContext,
) {
	const delay = Math.max(1, Math.round(delayMinutes));
	const denied = await requireConfirmation(ctx, `Schedule reboot in ${delay} minute(s)`);
	if (denied) return errorResult(denied);
	const result = await run("sudo", ["systemd-run", `--on-active=${delay}m`, "systemctl", "reboot"], signal);
	if (result.exitCode !== 0) {
		return errorResult(`Failed to schedule reboot:\n${result.stderr}`);
	}
	return {
		content: [{ type: "text" as const, text: `Reboot scheduled in ${delay} minute(s).` }],
		details: { delay_minutes: delay },
	};
}

// --- System health handler ---

export async function handleSystemHealth(signal: AbortSignal | undefined) {
	const [bootc, ps, df, loadavg, meminfo, uptime] = await Promise.all([
		run("bootc", ["status", "--format=json"], signal),
		run("podman", ["ps", "--format", "json", "--filter", "name=bloom-"], signal),
		run("df", ["-h", "/", "/var", "/home"], signal),
		run("cat", ["/proc/loadavg"], signal),
		run("free", ["-h", "--si"], signal),
		run("uptime", ["-p"], signal),
	]);

	const sections: string[] = [];

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

	if (df.exitCode === 0) {
		sections.push(`## Disk Usage\n\`\`\`\n${df.stdout.trim()}\n\`\`\``);
	}

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
	return { content: [{ type: "text" as const, text: truncate(text) }], details: {} };
}

// --- Update check hook handler ---

let updateChecked = false;

export async function checkPendingUpdates(systemPrompt: string): Promise<{ systemPrompt: string } | undefined> {
	if (updateChecked) return;
	updateChecked = true;
	try {
		const raw = await readFile(statusFile, "utf-8");
		const status = JSON.parse(raw) as UpdateStatus;
		if (status.available && !status.notified) {
			status.notified = true;
			await writeFile(statusFile, JSON.stringify(status), "utf-8");
			const note =
				"\n\n[SYSTEM] A Bloom OS update is available. " +
				"Inform the user and ask if they'd like to review and apply it.";
			return { systemPrompt: systemPrompt + note };
		}
	} catch {
		// No status file yet — timer hasn't run
	}
}
