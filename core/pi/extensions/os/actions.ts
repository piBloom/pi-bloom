/**
 * Handler / business logic for os.
 */

import fs from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { run } from "../../../lib/exec.js";
import { getSystemFlakeDir, getUpdateStatusPath } from "../../../lib/filesystem.js";
import { requireConfirmation } from "../../../lib/interactions.js";
import { type ActionResult, err, ok, truncate } from "../../../lib/utils.js";
import { guardServiceName } from "../../../lib/validation.js";
import type { ExitCodeDetails, NixosApplyDetails, ScheduleRebootDetails, UpdateStatus } from "./types.js";

// --- NixOS update handler ---

function generationStatusText(result: { stdout: string; stderr: string; exitCode: number }): string {
	return result.exitCode === 0 ? result.stdout.trim() || "No generation info available." : `Error: ${result.stderr}`;
}

async function handleNixosStatus(signal: AbortSignal | undefined): Promise<ActionResult<ExitCodeDetails>> {
	const gen = await run("nixos-rebuild", ["list-generations"], signal);
	return ok({ text: truncate(generationStatusText(gen)), details: { exitCode: gen.exitCode } });
}

async function handleNixosRollback(signal: AbortSignal | undefined): Promise<ActionResult<ExitCodeDetails>> {
	const result = await run("nixpi-brokerctl", ["nixos-update", "rollback"], signal);
	const text =
		result.exitCode === 0
			? "Rolled back to previous generation. Reboot to complete."
			: `Rollback failed: ${result.stderr}`;
	if (result.exitCode !== 0) return err(text);
	return ok({ text, details: { exitCode: result.exitCode } });
}

function ensureSystemFlakeExists(flake: string): string | null {
	if (fs.existsSync(path.join(flake, "flake.nix"))) return null;
	return (
		`System flake not found at ${flake}. The installed host flake at ${flake} is the running system's source of truth. ` +
		`Repair or reinstall that installed host flake before applying updates. Any operator checkout such as /srv/nixpi is optional and separate from system convergence.`
	);
}

async function handleNixosApply(signal: AbortSignal | undefined): Promise<ActionResult<NixosApplyDetails>> {
	const flakeDir = getSystemFlakeDir();
	const flakeError = ensureSystemFlakeExists(flakeDir);
	if (flakeError) return err(flakeError);

	const flake = `${flakeDir}#nixos`;
	const result = await run("nixpi-brokerctl", ["nixos-update", "apply", flake], signal);
	const text =
		result.exitCode === 0
			? `Update applied successfully from ${flake}. New generation is active.`
			: `Update failed: ${result.stderr}`;
	if (result.exitCode !== 0) return err(text);
	return ok({ text: truncate(text), details: { exitCode: result.exitCode, flake, flakeDir } });
}

export async function handleNixosUpdate(
	action: "status" | "apply" | "rollback",
	signal: AbortSignal | undefined,
	ctx: ExtensionContext,
): Promise<ActionResult<ExitCodeDetails | NixosApplyDetails>> {
	if (action === "apply" || action === "rollback") {
		const denied = await requireConfirmation(ctx, `OS ${action}`);
		if (denied) return err(denied);
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
): Promise<ActionResult<ExitCodeDetails>> {
	const guard = guardServiceName(service);
	if (guard) return err(guard);
	const unit = `${service}.service`;
	const readOnly = action === "status";
	if (!readOnly) {
		const denied = await requireConfirmation(ctx, `systemctl ${action} ${unit}`);
		if (denied) return err(denied);
	}
	const result = await run("nixpi-brokerctl", ["systemd", action, unit], signal);
	const text = truncate(result.stdout || result.stderr || `systemctl ${action} ${unit} completed.`);
	if (result.exitCode !== 0) return err(text);
	return ok({ text, details: { exitCode: result.exitCode } });
}

// --- Update status handler ---

export async function handleUpdateStatus(): Promise<ActionResult<UpdateStatus>> {
	try {
		const raw = await readFile(getUpdateStatusPath(), "utf-8");
		const status = JSON.parse(raw) as UpdateStatus;
		const text = status.available
			? `Update available (checked ${status.checked}). Current generation: ${status.generation ?? "unknown"}`
			: `System is up to date (checked ${status.checked}). Generation: ${status.generation ?? "unknown"}`;
		return ok({ text, details: status });
	} catch {
		return err("No update status available. The update timer may not have run yet.");
	}
}

// --- Schedule reboot handler ---

export async function handleScheduleReboot(
	delayMinutes: number,
	signal: AbortSignal | undefined,
	ctx: ExtensionContext,
): Promise<ActionResult<ScheduleRebootDetails>> {
	const delay = Math.max(1, Math.min(7 * 24 * 60, Math.round(delayMinutes)));
	const denied = await requireConfirmation(ctx, `Schedule reboot in ${delay} minute(s)`);
	if (denied) return err(denied);
	const result = await run("nixpi-brokerctl", ["schedule-reboot", String(delay)], signal);
	if (result.exitCode !== 0) {
		return err(`Failed to schedule reboot:\n${result.stderr}`);
	}
	return ok({ text: `Reboot scheduled in ${delay} minute(s).`, details: { delay_minutes: delay } });
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

// --- Bootstrap disable safety check ---

const BOOTSTRAP_DISABLE_RE = /nixpi\.bootstrap\.enable\s*=\s*false/;
const SSH_DISABLED_RE = /services\.openssh\.enable\s*=\s*false|nixpi\.bootstrap\.ssh\.enable\s*=\s*false/;
const CIDRS_RE = /allowedSourceCIDRs\s*=\s*\[\s*"/;
const INTERFACE_SSH_RE = /networking\.firewall\.interfaces\.[A-Za-z0-9_-]+\.allowedTCPPorts\s*=\s*\[[^\]]*\b22\b/;

function isNixHostFile(filePath: string): boolean {
	return filePath.endsWith("nixpi-host.nix") || /^\/etc\/nixos\/[^/]+\.nix$/.test(filePath);
}

export function checkBootstrapDisable(
	filePath: string,
	postEditContent: string,
): { block: true; reason: string } | undefined {
	if (!isNixHostFile(filePath)) return undefined;
	if (!BOOTSTRAP_DISABLE_RE.test(postEditContent)) return undefined;

	const sshEnabled = !SSH_DISABLED_RE.test(postEditContent);
	const cidrsConfigured = CIDRS_RE.test(postEditContent);
	const trustedInterfaceSshConfigured = INTERFACE_SSH_RE.test(postEditContent);

	if (sshEnabled && (cidrsConfigured || trustedInterfaceSshConfigured)) return undefined;

	const missing: string[] = [];
	if (!sshEnabled) missing.push("  services.openssh.enable = true;");
	if (!cidrsConfigured && !trustedInterfaceSshConfigured) {
		missing.push('  nixpi.security.ssh.allowedSourceCIDRs = [ "YOUR_IP/32" ];');
		missing.push('  # or: networking.firewall.interfaces.wg0.allowedTCPPorts = [ 22 ];');
	}

	const reason = [
		"Disabling bootstrap will remove passwordless sudo and may close SSH.",
		"",
		"Before this edit can proceed, keep SSH reachable via either a public CIDR allowlist or a trusted-interface firewall rule:",
		"",
		...missing,
		"",
		"Add the appropriate lines to nixpi-host.nix, then retry.",
	].join("\n");

	return { block: true, reason };
}
