/**
 * Test and session-start handlers for bloom-services.
 */
import { existsSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { run } from "../../lib/exec.js";
import { getQuadletDir } from "../../lib/filesystem.js";
import { loadManifest } from "../../lib/services-manifest.js";
import { validateServiceName } from "../../lib/services-validation.js";
import { createLogger, errorResult, truncate } from "../../lib/shared.js";
import { detectRunningServices } from "./service-io.js";

const log = createLogger("bloom-services");

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function handleTest(
	params: {
		name: string;
		start_timeout_sec?: number;
		cleanup?: boolean;
	},
	signal: AbortSignal | undefined,
) {
	const guard = validateServiceName(params.name);
	if (guard) return errorResult(guard);

	const timeoutSec = Math.max(10, Math.round(params.start_timeout_sec ?? 120));
	const cleanup = params.cleanup ?? false;
	const systemdDir = getQuadletDir();
	const userSystemdDir = join(os.homedir(), ".config", "systemd", "user");
	const containerDef = join(systemdDir, `bloom-${params.name}.container`);
	const socketDef = join(userSystemdDir, `bloom-${params.name}.socket`);
	if (!existsSync(containerDef)) {
		return errorResult(`Service not installed: ${containerDef} not found.`);
	}

	const socketMode = existsSync(socketDef);
	const serviceUnit = `bloom-${params.name}`;
	const startUnit = socketMode ? `${serviceUnit}.socket` : `${serviceUnit}.service`;

	const reload = await run("systemctl", ["--user", "daemon-reload"], signal);
	if (reload.exitCode !== 0) return errorResult(`daemon-reload failed:\n${reload.stderr}`);

	const startResult = await run("systemctl", ["--user", "start", startUnit], signal);
	if (startResult.exitCode !== 0) return errorResult(`Failed to start ${startUnit}:\n${startResult.stderr}`);

	let active = false;
	const waitUntil = Date.now() + timeoutSec * 1000;
	while (Date.now() < waitUntil) {
		const check = await run("systemctl", ["--user", "is-active", serviceUnit], signal);
		if (check.exitCode === 0 && check.stdout.trim() === "active") {
			active = true;
			break;
		}
		if (socketMode) {
			const socketActive = await run("systemctl", ["--user", "is-active", `${serviceUnit}.socket`], signal);
			if (socketActive.exitCode === 0 && socketActive.stdout.trim() === "active") {
				active = true;
				break;
			}
		}
		await sleep(2000);
	}

	const status = await run("systemctl", ["--user", "status", serviceUnit, "--no-pager"], signal);
	const logs = await run("journalctl", ["--user", "-u", serviceUnit, "-n", "80", "--no-pager"], signal);
	const socketStatus = socketMode
		? await run("systemctl", ["--user", "status", `${serviceUnit}.socket`, "--no-pager"], signal)
		: null;

	if (cleanup) {
		await run("systemctl", ["--user", "stop", serviceUnit], signal);
		if (socketMode) await run("systemctl", ["--user", "stop", `${serviceUnit}.socket`], signal);
	}

	const resultText = [
		`Service test: ${params.name}`,
		`Mode: ${socketMode ? "socket-activated" : "service"}`,
		`Result: ${active ? "PASS" : "FAIL"}`,
		"",
		"## systemctl status",
		"```",
		status.stdout.trim() || status.stderr.trim() || "(no output)",
		"```",
		...(socketStatus
			? [
					"",
					"## socket status",
					"```",
					socketStatus.stdout.trim() || socketStatus.stderr.trim() || "(no output)",
					"```",
				]
			: []),
		"",
		"## recent logs",
		"```",
		logs.stdout.trim() || logs.stderr.trim() || "(no log output)",
		"```",
	].join("\n");

	return {
		content: [{ type: "text" as const, text: truncate(resultText) }],
		details: { active, socketMode, cleanup },
		isError: !active,
	};
}

export async function handleSessionStart(manifestPath: string, ctx: ExtensionContext) {
	log.info("service lifecycle extension loaded");

	if (ctx.hasUI) {
		ctx.ui.setStatus("bloom-services", "Services: lifecycle tools ready");
	}

	if (!existsSync(manifestPath)) return;
	const manifest = loadManifest(manifestPath);
	const svcCount = Object.keys(manifest.services).length;
	if (svcCount === 0) return;

	const running = await detectRunningServices();
	const drifts: string[] = [];
	for (const [name, svc] of Object.entries(manifest.services)) {
		if (svc.enabled && !running.has(name)) {
			drifts.push(`${name} (not running)`);
		}
	}

	if (ctx.hasUI) {
		if (drifts.length > 0) {
			ctx.ui.setWidget("bloom-services", [`Manifest drift: ${drifts.join(", ")}`]);
		}
		ctx.ui.setStatus("bloom-services", `Services: ${svcCount} in manifest`);
	}
}
