/**
 * Dev-mode lifecycle handlers: enable, disable, status, and code-server management.
 *
 * @module actions-lifecycle
 */
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../core/lib/exec.js";
import { errorResult } from "../../core/lib/shared.js";

const SENTINEL = ".dev-enabled";

/** Resolve the sentinel file path within the bloom runtime directory. */
function sentinelPath(bloomRuntime: string): string {
	return join(bloomRuntime, SENTINEL);
}

/** Check whether dev mode is enabled by testing for the sentinel file. */
export function isDevEnabled(bloomRuntime: string): boolean {
	return existsSync(sentinelPath(bloomRuntime));
}

/** Enable dev mode by writing the sentinel file. */
export async function handleDevEnable(bloomRuntime: string) {
	mkdirSync(bloomRuntime, { recursive: true });
	writeFileSync(sentinelPath(bloomRuntime), new Date().toISOString(), "utf-8");
	return {
		content: [{ type: "text" as const, text: "Dev mode enabled." }],
		details: { enabled: true },
	};
}

/** Disable dev mode by removing the sentinel file. */
export async function handleDevDisable(bloomRuntime: string) {
	try {
		unlinkSync(sentinelPath(bloomRuntime));
	} catch {
		// Already absent — that's fine
	}
	return {
		content: [{ type: "text" as const, text: "Dev mode disabled." }],
		details: { enabled: false },
	};
}

/** Report current dev environment status. */
export async function handleDevStatus(bloomRuntime: string, signal?: AbortSignal) {
	const enabled = isDevEnabled(bloomRuntime);
	const repoDir = join(bloomRuntime, "pi-bloom");

	const repoCheck = await run("git", ["-C", repoDir, "rev-parse", "--git-dir"], signal);
	const repoConfigured = repoCheck.exitCode === 0;

	const csCheck = await run("systemctl", ["--user", "is-active", "bloom-code-server.service"], signal);
	const codeServerRunning = csCheck.exitCode === 0 && csCheck.stdout.trim() === "active";

	const imgCheck = await run("podman", ["image", "exists", "localhost/bloom:dev"], signal);
	const localBuildAvailable = imgCheck.exitCode === 0;

	const lines: string[] = [
		`Dev mode: ${enabled ? "enabled" : "disabled"}`,
		`Repo configured: ${repoConfigured}`,
		`code-server: ${codeServerRunning ? "running" : "not running"}`,
		`Local build: ${localBuildAvailable ? "available" : "none"}`,
	];

	if (repoConfigured) lines.push(`Repo path: ${repoDir}`);
	if (localBuildAvailable) lines.push("Image tag: localhost/bloom:dev");

	return {
		content: [{ type: "text" as const, text: lines.join("\n") }],
		details: {
			enabled,
			repoConfigured,
			codeServerRunning,
			localBuildAvailable,
			repoPath: repoConfigured ? repoDir : undefined,
			localImageTag: localBuildAvailable ? "localhost/bloom:dev" : undefined,
		},
	};
}

/** Start, stop, restart, or check status of the code-server development environment. */
export async function handleDevCodeServer(action: "start" | "stop" | "restart" | "status", signal?: AbortSignal) {
	const unit = "bloom-code-server";

	if (action === "status") {
		const result = await run("systemctl", ["--user", "is-active", unit], signal);
		const active = result.exitCode === 0 && result.stdout.trim() === "active";
		return {
			content: [{ type: "text" as const, text: `code-server is ${active ? "running" : "stopped"}.` }],
			details: { running: active },
		};
	}

	if (action === "start" || action === "restart") {
		const reload = await run("systemctl", ["--user", "daemon-reload"], signal);
		if (reload.exitCode !== 0) {
			return errorResult(`daemon-reload failed: ${reload.stderr}`);
		}
	}

	const result = await run("systemctl", ["--user", action, unit], signal);
	if (result.exitCode !== 0) {
		return errorResult(`systemctl ${action} ${unit} failed: ${result.stderr}`);
	}

	return {
		content: [{ type: "text" as const, text: `code-server ${action} succeeded.` }],
		details: { action },
	};
}
