/**
 * Handler / business logic for bloom-dev.
 */
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { run } from "../../lib/exec.js";
import { errorResult, requireConfirmation, truncate } from "../../lib/shared.js";
import type { DevBuildResult, DevTestResult } from "./types.js";

const DEV_IMAGE_TAG = "localhost/bloom:dev";

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
// Handler implementations
// ---------------------------------------------------------------------------

/** Start, stop, restart, or check status of the code-server development environment. */
export async function handleDevCodeServer(
	_bloomRuntime: string,
	action: "start" | "stop" | "restart" | "status",
	signal?: AbortSignal,
) {
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

/** Build a local container image from the repo. */
export async function handleDevBuild(repoDir: string, signal?: AbortSignal, tag?: string) {
	const imageTag = tag ?? DEV_IMAGE_TAG;
	const containerfile = join(repoDir, "os", "Containerfile");

	if (!existsSync(containerfile)) {
		return errorResult(`Containerfile not found at ${containerfile}. Is the repo cloned?`);
	}

	const start = Date.now();
	const result = await run("podman", ["build", "-f", containerfile, "-t", imageTag, repoDir], signal);
	const duration = Math.round((Date.now() - start) / 1000);

	if (result.exitCode !== 0) {
		const buildResult: DevBuildResult = { success: false, imageTag, duration, error: result.stderr };
		return {
			content: [{ type: "text" as const, text: `Build failed after ${duration}s:\n${truncate(result.stderr)}` }],
			details: buildResult,
			isError: true,
		};
	}

	const inspect = await run("podman", ["image", "inspect", imageTag, "--format", "{{.Size}}"], signal);
	const size = inspect.exitCode === 0 ? inspect.stdout.trim() : undefined;

	const buildResult: DevBuildResult = { success: true, imageTag, duration, size };
	return {
		content: [
			{
				type: "text" as const,
				text: `Build succeeded in ${duration}s. Image: ${imageTag}${size ? ` (${size} bytes)` : ""}`,
			},
		],
		details: buildResult,
	};
}

/** Switch the running OS to a local or remote image. */
export async function handleDevSwitch(
	_bloomRuntime: string,
	imageRef: string | undefined,
	signal: AbortSignal | undefined,
	ctx: ExtensionContext,
) {
	const tag = imageRef ?? DEV_IMAGE_TAG;

	const exists = await run("podman", ["image", "exists", tag], signal);
	if (exists.exitCode !== 0) {
		return errorResult(`Image ${tag} not found. Run dev_build first.`);
	}

	const denied = await requireConfirmation(ctx, `Switch OS to image ${tag}`);
	if (denied) return errorResult(denied);

	const result = await run("sudo", ["bootc", "switch", "--transport", "containers-storage", tag], signal);
	if (result.exitCode !== 0) {
		return errorResult(`bootc switch failed: ${result.stderr}`);
	}

	return {
		content: [{ type: "text" as const, text: `Switched to ${tag}. Reboot to apply.` }],
		details: { imageRef: tag, switched: true },
	};
}

/** Rollback to the previous OS deployment. */
export async function handleDevRollback(_bloomRuntime: string, signal: AbortSignal | undefined, ctx: ExtensionContext) {
	const denied = await requireConfirmation(ctx, "Rollback OS to previous deployment");
	if (denied) return errorResult(denied);

	const result = await run("sudo", ["bootc", "rollback"], signal);
	if (result.exitCode !== 0) {
		return errorResult(`bootc rollback failed: ${result.stderr}`);
	}

	return {
		content: [{ type: "text" as const, text: "Rollback staged. Reboot to apply." }],
		details: { rolledBack: true },
	};
}

/** Run the edit-build-switch development loop. */
export async function handleDevLoop(_bloomRuntime: string, _signal?: AbortSignal) {
	return errorResult("Not yet implemented: dev_loop");
}

/** Run tests and linting against the local repo. */
export async function handleDevTest(repoDir: string, signal?: AbortSignal) {
	const packageJson = join(repoDir, "package.json");
	if (!existsSync(packageJson)) {
		return errorResult(`package.json not found at ${packageJson}. Is the repo cloned?`);
	}

	const testResult = await run("npm", ["run", "test", "--", "--run"], signal, repoDir);
	const testsPassed = testResult.exitCode === 0;
	const testOutput = truncate(testResult.stdout + (testResult.stderr ? `\n${testResult.stderr}` : ""));

	const lintResult = await run("npm", ["run", "check"], signal, repoDir);
	const lintPassed = lintResult.exitCode === 0;
	const lintOutput = truncate(lintResult.stdout + (lintResult.stderr ? `\n${lintResult.stderr}` : ""));

	const success = testsPassed && lintPassed;
	const lines: string[] = [];
	lines.push(`Tests: ${testsPassed ? "PASSED" : "FAILED"}`);
	lines.push(`Lint: ${lintPassed ? "PASSED" : "FAILED"}`);
	if (!testsPassed) lines.push(`\n--- Test output ---\n${testOutput}`);
	if (!lintPassed) lines.push(`\n--- Lint output ---\n${lintOutput}`);

	const details: DevTestResult = { success, testsPassed, lintPassed, testOutput, lintOutput };
	return {
		content: [{ type: "text" as const, text: lines.join("\n") }],
		details,
		...(success ? {} : { isError: true }),
	};
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
