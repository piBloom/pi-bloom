/**
 * Handler / business logic for os.
 */

import fs from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { run } from "../../../lib/exec.js";
import {
	getSystemFlakeDir,
	getUpdateStatusPath,
} from "../../../lib/filesystem.js";
import { requireConfirmation } from "../../../lib/interactions.js";
import { errorResult, truncate } from "../../../lib/utils.js";
import { guardServiceName } from "../../../lib/validation.js";
import type { UpdateStatus } from "./types.js";

type OsActionResult = {
	content: Array<{ type: "text"; text: string }>;
	details: Record<string, unknown>;
	isError?: boolean;
};

// --- NixOS update handler ---

function generationStatusText(result: { stdout: string; stderr: string; exitCode: number }): string {
	return result.exitCode === 0 ? result.stdout.trim() || "No generation info available." : `Error: ${result.stderr}`;
}

async function confirmOsMutation(action: "apply" | "rollback", ctx: ExtensionContext): Promise<{ denied?: string }> {
	const denied = await requireConfirmation(ctx, `OS ${action}`);
	return denied ? { denied } : {};
}

async function handleNixosStatus(signal: AbortSignal | undefined): Promise<OsActionResult> {
	const gen = await run("nixos-rebuild", ["list-generations"], signal);
	return {
		content: [{ type: "text" as const, text: truncate(generationStatusText(gen)) }],
		details: { exitCode: gen.exitCode },
	} satisfies OsActionResult;
}

async function handleNixosRollback(signal: AbortSignal | undefined): Promise<OsActionResult> {
	const result = await run("nixpi-brokerctl", ["nixos-update", "rollback"], signal);
	const text =
		result.exitCode === 0
			? "Rolled back to previous generation. Reboot to complete."
			: `Rollback failed: ${result.stderr}`;
	return {
		content: [{ type: "text" as const, text }],
		details: { exitCode: result.exitCode },
		isError: result.exitCode !== 0,
	} satisfies OsActionResult;
}

function ensureSystemFlakeExists(flake: string): OsActionResult | null {
	if (fs.existsSync(path.join(flake, "flake.nix"))) {
		return null;
	}

	return errorResult(
		`System flake not found at ${flake}. The installed host flake at ${flake} is the running system's source of truth. ` +
			`Repair or reinstall that installed host flake before applying updates. Any operator checkout such as /srv/nixpi is optional and separate from system convergence.`,
	);
}

async function handleNixosApply(signal: AbortSignal | undefined): Promise<OsActionResult> {
	const flakeDir = getSystemFlakeDir();
	const flakeError = ensureSystemFlakeExists(flakeDir);
	if (flakeError) {
		return flakeError;
	}

	const flake = `${flakeDir}#nixos`;
	const result = await run("nixpi-brokerctl", ["nixos-update", "apply", flake], signal);
	const text =
		result.exitCode === 0
			? `Update applied successfully from ${flake}. New generation is active.`
			: `Update failed: ${result.stderr}`;
	return {
		content: [{ type: "text" as const, text: truncate(text) }],
		details: { exitCode: result.exitCode, flake, flakeDir },
		isError: result.exitCode !== 0,
	} satisfies OsActionResult;
}

export async function handleNixosUpdate(
	action: "status" | "apply" | "rollback",
	signal: AbortSignal | undefined,
	ctx: ExtensionContext,
): Promise<OsActionResult> {
	if (action === "apply" || action === "rollback") {
		const confirmation = await confirmOsMutation(action, ctx);
		if (confirmation.denied) return errorResult(confirmation.denied);
	}

	switch (action) {
		case "status":
			return handleNixosStatus(signal);
		case "rollback":
			return handleNixosRollback(signal);
		case "apply":
			return handleNixosApply(signal);
	}
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
