/**
 * Handler / business logic for os.
 */

import fs from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { run } from "../../../lib/exec.js";
import {
	assertSupportedRebuildBranch,
	getCanonicalRepoDir,
	getSystemFlakeDir,
	getUpdateStatusPath,
} from "../../../lib/filesystem.js";
import { requireConfirmation } from "../../../lib/interactions.js";
import { errorResult, truncate } from "../../../lib/utils.js";
import { guardServiceName } from "../../../lib/validation.js";
import type { UpdateStatus } from "./types.js";

// --- NixOS update handler ---

export async function handleNixosUpdate(
	action: "status" | "apply" | "rollback",
	signal: AbortSignal | undefined,
	ctx: ExtensionContext,
) {
	if (action === "apply" || action === "rollback") {
		const target = `OS ${action}`;
		const denied = await requireConfirmation(ctx, target);
		if (denied) return errorResult(denied);
	}

	if (action === "status") {
		const gen = await run("nixos-rebuild", ["list-generations"], signal);
		const text = gen.exitCode === 0 ? gen.stdout.trim() || "No generation info available." : `Error: ${gen.stderr}`;
		return { content: [{ type: "text" as const, text: truncate(text) }], details: { exitCode: gen.exitCode } };
	}

	if (action === "rollback") {
		const result = await run("nixpi-brokerctl", ["nixos-update", "rollback"], signal);
		const text =
			result.exitCode === 0
				? "Rolled back to previous generation. Reboot to complete."
				: `Rollback failed: ${result.stderr}`;
		return {
			content: [{ type: "text" as const, text }],
			details: { exitCode: result.exitCode },
			isError: result.exitCode !== 0,
		};
	}

	// apply
	const flake = getSystemFlakeDir();
	if (!fs.existsSync(path.join(flake, "flake.nix"))) {
		return errorResult(
			`System flake not found at ${flake}. Supported rebuilds use /etc/nixos with the canonical repo at /srv/nixpi; switch to main in /srv/nixpi and ensure ${flake}/flake.nix exists.`,
		);
	}
	const repoDir = getCanonicalRepoDir();
	const branchResult = await run("git", ["-C", repoDir, "branch", "--show-current"], signal);
	if (branchResult.exitCode !== 0) {
		return errorResult(`Failed to determine canonical repo branch at ${repoDir}: ${branchResult.stderr}`);
	}
	try {
		assertSupportedRebuildBranch(branchResult.stdout.trim());
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return errorResult(`${message}. switch to main in ${repoDir} before rebuilding from ${flake}.`);
	}
	const args = ["nixos-update", "apply"];
	args.push(flake);
	const result = await run("nixpi-brokerctl", args, signal);
	const text =
		result.exitCode === 0
			? `Update applied successfully from ${flake}. New generation is active.`
			: `Update failed: ${result.stderr}`;
	return {
		content: [{ type: "text" as const, text: truncate(text) }],
		details: { exitCode: result.exitCode, flake },
		isError: result.exitCode !== 0,
	};
}

// --- Systemd handler ---

export async function handleSystemdControl(
	service: string,
	action: "start" | "stop" | "restart" | "status",
	signal: AbortSignal | undefined,
	ctx: ExtensionContext,
) {
	const guard = guardServiceName(service);
	if (guard) return errorResult(guard);
	const unit = `${service}.service`;
	const readOnly = action === "status";
	if (!readOnly) {
		const denied = await requireConfirmation(ctx, `systemctl ${action} ${unit}`);
		if (denied) return errorResult(denied);
	}
	const brokerAction = action;
	const result = await run("nixpi-brokerctl", ["systemd", brokerAction, unit], signal);
	const text = truncate(result.stdout || result.stderr || `systemctl ${action} ${unit} completed.`);
	return {
		content: [{ type: "text" as const, text }],
		details: { exitCode: result.exitCode },
		isError: result.exitCode !== 0,
	};
}

// --- Update status handler ---

export async function handleUpdateStatus() {
	try {
		const raw = await readFile(getUpdateStatusPath(), "utf-8");
		const status = JSON.parse(raw) as UpdateStatus;
		const text = status.available
			? `Update available (checked ${status.checked}). Current generation: ${status.generation ?? "unknown"}`
			: `System is up to date (checked ${status.checked}). Generation: ${status.generation ?? "unknown"}`;
		return { content: [{ type: "text" as const, text }], details: status };
	} catch {
		return errorResult("No update status available. The update timer may not have run yet.");
	}
}

// --- Schedule reboot handler ---

export async function handleScheduleReboot(
	delayMinutes: number,
	signal: AbortSignal | undefined,
	ctx: ExtensionContext,
) {
	const delay = Math.max(1, Math.min(7 * 24 * 60, Math.round(delayMinutes)));
	const denied = await requireConfirmation(ctx, `Schedule reboot in ${delay} minute(s)`);
	if (denied) return errorResult(denied);
	const result = await run("nixpi-brokerctl", ["schedule-reboot", String(delay)], signal);
	if (result.exitCode !== 0) {
		return errorResult(`Failed to schedule reboot:\n${result.stderr}`);
	}
	return {
		content: [{ type: "text" as const, text: `Reboot scheduled in ${delay} minute(s).` }],
		details: { delay_minutes: delay },
	};
}

// --- Update check hook handler ---

export async function checkPendingUpdates(systemPrompt: string): Promise<{ systemPrompt: string } | undefined> {
	const statusFile = getUpdateStatusPath();
	try {
		const raw = await readFile(statusFile, "utf-8");
		const status = JSON.parse(raw) as UpdateStatus;
		if (status.available && !status.notified) {
			status.notified = true;
			await writeFile(statusFile, JSON.stringify(status), "utf-8");
			const note =
				"\n\n[SYSTEM] A NixPI update is available. " + "Inform the user and ask if they'd like to review and apply it.";
			return { systemPrompt: systemPrompt + note };
		}
	} catch {
		// No status file yet — timer hasn't run
	}
}
