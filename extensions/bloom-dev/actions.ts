/**
 * Handler / business logic for bloom-dev.
 */
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../lib/exec.js";
import { errorResult } from "../../lib/shared.js";

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

// ---------------------------------------------------------------------------
// Stub handlers — not yet implemented
// ---------------------------------------------------------------------------

/** Start or stop the code-server development environment. */
export async function handleDevCodeServer(
	_bloomRuntime: string,
	_action: string,
	_signal?: AbortSignal,
) {
	return errorResult("Not yet implemented: dev_code_server");
}

/** Build a local container image from the repo. */
export async function handleDevBuild(_bloomRuntime: string, _signal?: AbortSignal) {
	return errorResult("Not yet implemented: dev_build");
}

/** Switch the running OS to a local or remote image. */
export async function handleDevSwitch(
	_bloomRuntime: string,
	_imageRef: string,
	_signal?: AbortSignal,
) {
	return errorResult("Not yet implemented: dev_switch");
}

/** Rollback to the previous OS deployment. */
export async function handleDevRollback(_bloomRuntime: string, _signal?: AbortSignal) {
	return errorResult("Not yet implemented: dev_rollback");
}

/** Run the edit-build-switch development loop. */
export async function handleDevLoop(_bloomRuntime: string, _signal?: AbortSignal) {
	return errorResult("Not yet implemented: dev_loop");
}

/** Run tests and linting. */
export async function handleDevTest(_bloomRuntime: string, _signal?: AbortSignal) {
	return errorResult("Not yet implemented: dev_test");
}

/** Submit a pull request from local changes. */
export async function handleDevSubmitPr(_bloomRuntime: string, _signal?: AbortSignal) {
	return errorResult("Not yet implemented: dev_submit_pr");
}

/** Push a skill to the device. */
export async function handleDevPushSkill(_bloomRuntime: string, _signal?: AbortSignal) {
	return errorResult("Not yet implemented: dev_push_skill");
}

/** Push a service to the device. */
export async function handleDevPushService(_bloomRuntime: string, _signal?: AbortSignal) {
	return errorResult("Not yet implemented: dev_push_service");
}

/** Push an extension to the device. */
export async function handleDevPushExtension(_bloomRuntime: string, _signal?: AbortSignal) {
	return errorResult("Not yet implemented: dev_push_extension");
}

/** Install a Pi package from a local path. */
export async function handleDevInstallPackage(_bloomRuntime: string, _signal?: AbortSignal) {
	return errorResult("Not yet implemented: dev_install_package");
}
