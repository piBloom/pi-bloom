/**
 * Build and deploy handlers: container image build, OS switch, rollback, and the dev loop.
 *
 * @module actions-build
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { run } from "../../core/lib/exec.js";
import { errorResult, requireConfirmation, truncate } from "../../core/lib/shared.js";
import type { DevBuildResult } from "./types.js";

const DEV_IMAGE_TAG = "localhost/bloom:dev";

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
	imageRef: string | undefined,
	signal: AbortSignal | undefined,
	ctx: ExtensionContext,
) {
	const tag = imageRef ?? DEV_IMAGE_TAG;

	if (tag.startsWith("-")) {
		return errorResult("Invalid image reference: must not start with '-'");
	}

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
export async function handleDevRollback(signal: AbortSignal | undefined, ctx: ExtensionContext) {
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

/** Run the edit-build-switch development loop: build -> switch -> reboot. */
export async function handleDevLoop(
	params: { tag?: string; skip_reboot?: boolean },
	signal?: AbortSignal,
	ctx?: ExtensionContext,
	repoDir?: string,
) {
	if (!repoDir) return errorResult("Repo directory not configured.");

	const steps: string[] = [];

	// Step 1: Build
	const buildResult = await handleDevBuild(repoDir, signal, params.tag);
	if ("isError" in buildResult && buildResult.isError) return buildResult;
	steps.push(`Build: ${buildResult.content[0].text}`);

	// Step 2: Switch (if ctx is undefined, skip confirmation inside handleDevSwitch)
	if (!ctx) {
		return errorResult("Cannot perform dev loop without an extension context for confirmation.");
	}
	const switchResult = await handleDevSwitch(params.tag, signal, ctx);
	if ("isError" in switchResult && switchResult.isError) return switchResult;
	steps.push(`Switch: ${switchResult.content[0].text}`);

	// Step 3: Reboot or report
	if (params.skip_reboot) {
		steps.push("Reboot skipped — run `sudo reboot` when ready.");
	} else {
		const reboot = await run("sudo", ["shutdown", "-r", "+0", "bloom dev loop"], signal);
		if (reboot.exitCode !== 0) {
			steps.push(`Reboot failed: ${reboot.stderr}`);
		} else {
			steps.push("Reboot initiated.");
		}
	}

	return {
		content: [{ type: "text" as const, text: steps.join("\n") }],
		details: { steps },
	};
}
