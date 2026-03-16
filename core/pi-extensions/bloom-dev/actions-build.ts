/**
 * Build and deploy handlers: nix build, NixOS switch, rollback, and the dev loop.
 *
 * @module actions-build
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { run } from "../../lib/exec.js";
import { errorResult, requireConfirmation, truncate } from "../../lib/shared.js";
import type { DevBuildResult } from "./types.js";

const NIX_BIN = "/nix/var/nix/profiles/default/bin/nix";

/** Build the bloom-app derivation using nix build. */
export async function handleDevBuild(repoDir: string, signal?: AbortSignal, tag?: string) {
	const flakeDir = repoDir;

	if (!existsSync(flakeDir)) {
		return errorResult(`Repo directory not found at ${flakeDir}. Is the repo cloned?`);
	}

	const start = Date.now();
	const result = await run(NIX_BIN, ["build", ".#bloom-app"], signal, flakeDir);
	const duration = Math.round((Date.now() - start) / 1000);

	if (result.exitCode !== 0) {
		const buildResult: DevBuildResult = { success: false, imageTag: tag, duration, error: result.stderr };
		return {
			content: [{ type: "text" as const, text: `Build failed after ${duration}s:\n${truncate(result.stderr)}` }],
			details: buildResult,
			isError: true,
		};
	}

	const buildResult: DevBuildResult = { success: true, imageTag: tag, duration };
	return {
		content: [
			{
				type: "text" as const,
				text: `Build succeeded in ${duration}s. Result symlink created at ${join(flakeDir, "result")}`,
			},
		],
		details: buildResult,
	};
}

/** Switch the running NixOS system to the local flake configuration. */
export async function handleDevSwitch(
	imageRef: string | undefined,
	signal: AbortSignal | undefined,
	ctx: ExtensionContext,
) {
	const denied = await requireConfirmation(ctx, "Switch NixOS to local flake configuration");
	if (denied) return errorResult(denied);

	const result = await run("sudo", ["nixos-rebuild", "switch", "--flake", "."], signal);
	if (result.exitCode !== 0) {
		return errorResult(`nixos-rebuild switch failed: ${result.stderr}`);
	}

	return {
		content: [{ type: "text" as const, text: "Switched to local NixOS configuration. Changes are active." }],
		details: { switched: true },
	};
}

/** Rollback to the previous NixOS generation. */
export async function handleDevRollback(signal: AbortSignal | undefined, ctx: ExtensionContext) {
	const denied = await requireConfirmation(ctx, "Rollback NixOS to previous generation");
	if (denied) return errorResult(denied);

	const result = await run("sudo", ["nixos-rebuild", "switch", "--rollback"], signal);
	if (result.exitCode !== 0) {
		return errorResult(`nixos-rebuild rollback failed: ${result.stderr}`);
	}

	return {
		content: [{ type: "text" as const, text: "Rolled back to previous NixOS generation. Changes are active." }],
		details: { rolledBack: true },
	};
}

/** Run the edit-build-switch development loop: nix build -> nixos-rebuild switch. */
export async function handleDevLoop(
	params: { tag?: string; skip_reboot?: boolean },
	signal?: AbortSignal,
	ctx?: ExtensionContext,
	repoDir?: string,
) {
	if (!repoDir) return errorResult("Repo directory not configured.");

	const steps: string[] = [];

	// Step 1: nix build .#bloom-app
	const buildResult = await handleDevBuild(repoDir, signal, params.tag);
	if ("isError" in buildResult && buildResult.isError) return buildResult;
	steps.push(`Build: ${buildResult.content[0].text}`);

	// Step 2: nixos-rebuild switch --flake .
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
