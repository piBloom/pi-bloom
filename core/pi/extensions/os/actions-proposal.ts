import { existsSync } from "node:fs";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { run } from "../../../lib/exec.js";
import { getWorkspaceRepoDir } from "../../../lib/filesystem.js";
import { errorResult, requireConfirmation, truncate } from "../../../lib/shared.js";

export type NixConfigProposalAction = "status" | "validate" | "update_flake_lock";

const DEFAULT_CHECK = "checks.x86_64-linux.config";

function summarizeOutput(result: { stdout: string; stderr: string; exitCode: number }): string {
	return truncate((result.stdout || result.stderr || "").trim() || "(no output)");
}

export async function handleNixConfigProposal(
	action: NixConfigProposalAction,
	signal: AbortSignal | undefined,
	ctx: ExtensionContext,
) {
	const repoDir = getWorkspaceRepoDir();
	if (!existsSync(repoDir)) {
		return errorResult(`Local nixPI repo not found at ${repoDir}. The proposal workflow expects a cloned repo there.`);
	}

	if (action === "status") {
		const [branch, status, diff] = await Promise.all([
			run("git", ["branch", "--show-current"], signal, repoDir),
			run("git", ["status", "--short"], signal, repoDir),
			run("git", ["diff", "--stat", "--", "flake.nix", "flake.lock", "core/os", "justfile"], signal, repoDir),
		]);

		const lines = [
			`Local proposal repo: ${repoDir}`,
			`Branch: ${(branch.stdout || branch.stderr).trim() || "(detached or unknown)"}`,
			"",
			"Working tree:",
			status.stdout.trim() || "Clean",
			"",
			"Nix-related diff:",
			diff.stdout.trim() || "No diff in flake.nix, flake.lock, core/os, or justfile.",
		];

		return {
			content: [{ type: "text" as const, text: truncate(lines.join("\n")) }],
			details: {
				repoDir,
				branch: branch.stdout.trim(),
				clean: status.stdout.trim().length === 0,
			},
		};
	}

	if (action === "update_flake_lock") {
		const denied = await requireConfirmation(ctx, `Refresh flake.lock in ${repoDir}`);
		if (denied) return errorResult(denied);

		const update = await run("nix", ["flake", "update"], signal, repoDir);
		const status = await run("git", ["status", "--short", "--", "flake.lock"], signal, repoDir);
		const text =
			update.exitCode === 0
				? [
						`Updated flake inputs in ${repoDir}.`,
						"",
						"Command output:",
						summarizeOutput(update),
						"",
						"flake.lock status:",
						status.stdout.trim() || "flake.lock unchanged.",
					].join("\n")
				: `nix flake update failed:\n${summarizeOutput(update)}`;
		return {
			content: [{ type: "text" as const, text: truncate(text) }],
			details: { repoDir, exitCode: update.exitCode },
			isError: update.exitCode !== 0,
		};
	}

	const [flakeCheck, configBuild] = await Promise.all([
		run("nix", ["flake", "check", "--no-build"], signal, repoDir),
		run("nix", ["build", `.#${DEFAULT_CHECK}`, "--no-link"], signal, repoDir),
	]);
	const ok = flakeCheck.exitCode === 0 && configBuild.exitCode === 0;
	const text = [
		`Validated local Workspace repo at ${repoDir}`,
		"",
		`nix flake check --no-build: ${flakeCheck.exitCode === 0 ? "ok" : "failed"}`,
		summarizeOutput(flakeCheck),
		"",
		`nix build .#${DEFAULT_CHECK} --no-link: ${configBuild.exitCode === 0 ? "ok" : "failed"}`,
		summarizeOutput(configBuild),
	].join("\n");

	return {
		content: [{ type: "text" as const, text: truncate(text) }],
		details: { repoDir, flakeCheck: flakeCheck.exitCode, configBuild: configBuild.exitCode },
		isError: !ok,
	};
}
