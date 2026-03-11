/**
 * Test, pair, and session-start handlers for bloom-services.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import QRCode from "qrcode";
import { run } from "../../lib/exec.js";
import { loadManifest } from "../../lib/services-manifest.js";
import { validateServiceName } from "../../lib/services-validation.js";
import { createLogger, errorResult, truncate } from "../../lib/shared.js";
import { registerMatrixAccount } from "./matrix-register.js";
import { detectRunningServices } from "./service-io.js";

const log = createLogger("bloom-services");

export function sleep(ms: number): Promise<void> {
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
	const systemdDir = join(os.homedir(), ".config", "containers", "systemd");
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

export async function handlePair(
	params: {
		name: "element";
		username: string;
	},
	_signal: AbortSignal | undefined,
) {
	const serviceName = params.name;
	const username = params.username.toLowerCase().replace(/[^a-z0-9._=-]/g, "");
	if (!username) return errorResult("Invalid username — must contain at least one letter or number.");

	// Check matrix server is installed
	const systemdDir = join(os.homedir(), ".config", "containers", "systemd");
	if (!existsSync(join(systemdDir, "bloom-matrix.container"))) {
		return errorResult('Matrix server is not installed. Run service_install(name="matrix") first.');
	}

	// Read registration token
	const envFile = join(os.homedir(), ".config", "bloom", "matrix.env");
	let registrationToken = "";
	try {
		const content = readFileSync(envFile, "utf-8");
		const match = content.match(/CONTINUWUITY_REGISTRATION_TOKEN=(.+)/);
		if (match) registrationToken = match[1].trim();
	} catch {
		return errorResult(`Cannot read registration token from ${envFile}`);
	}
	if (!registrationToken) {
		return errorResult("No registration token found. Check ~/.config/bloom/matrix.env");
	}

	// Homeserver URL — use localhost for API calls (containers use bloom-matrix internally)
	const localUrl = "http://localhost:6167";

	// Generate passwords
	const userPassword = randomBytes(16).toString("base64url");
	const botPassword = randomBytes(16).toString("base64url");

	// --- Register user account ---
	const userResult = await registerMatrixAccount(localUrl, username, userPassword, registrationToken);
	if (!userResult.ok) {
		return errorResult(`Failed to create account @${username}:bloom — ${userResult.error}`);
	}

	// --- Register pi bot account ---
	const botResult = await registerMatrixAccount(localUrl, "pi", botPassword, registrationToken);
	if (!botResult.ok) {
		// If pi already exists, that's fine — but we need the password in element.env
		if (!botResult.error.includes("taken")) {
			return errorResult(`Failed to create bot account @pi:bloom — ${botResult.error}`);
		}
		log.info("Bot account @pi:bloom already exists, skipping creation.");
	}

	// --- Save bot credentials for the Element bridge container ---
	if (botResult.ok) {
		const configDir = join(os.homedir(), ".config", "bloom");
		mkdirSync(configDir, { recursive: true });
		writeFileSync(join(configDir, "element.env"), `BLOOM_MATRIX_PASSWORD=${botPassword}\n`);
	}

	// --- Build instructions for the user ---
	const hostname = os.hostname();
	const externalUrl = `http://${hostname}:6167`;

	const instructions = [
		`Your Matrix account is ready:`,
		"",
		`  Homeserver:  ${externalUrl}`,
		`  Username:    ${username}`,
		`  Password:    ${userPassword}`,
		"",
		"Open Element X (or any Matrix client):",
		`1. Tap "Sign in" (not "Create account")`,
		`2. Set homeserver to: ${externalUrl}`,
		"3. Enter the username and password above",
		"4. To message Pi, start a DM with @pi:bloom",
	].join("\n");

	try {
		const qrArt = await QRCode.toString(externalUrl, { type: "terminal", small: true });
		return {
			content: [{ type: "text" as const, text: `${instructions}\n\nScan to open homeserver:\n${qrArt}` }],
			details: {
				service: serviceName,
				serverUrl: externalUrl,
				userId: userResult.userId,
				username,
				password: userPassword,
			},
		};
	} catch {
		return {
			content: [{ type: "text" as const, text: instructions }],
			details: {
				service: serviceName,
				serverUrl: externalUrl,
				userId: userResult.userId,
				username,
				password: userPassword,
			},
		};
	}
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
