import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { run } from "../../../lib/exec.js";
import { getSystemFlakeDir } from "../../../lib/filesystem.js";
import { requireConfirmation } from "../../../lib/interactions.js";
import { errorResult, truncate } from "../../../lib/utils.js";

export type NixConfigProposalAction = "status" | "validate" | "update_flake_lock";

const DEFAULT_CHECK = "checks.x86_64-linux.config";
const PROPOSAL_REPO_DIR = "/var/lib/nixpi/pi-nixpi";

function summarizeOutput(result: { stdout: string; stderr: string; exitCode: number }): string {
	return truncate((result.stdout || result.stderr || "").trim() || "(no output)");
}

async function ensureProposalRepo(
	repoDir: string,
	signal: AbortSignal | undefined,
): Promise<{ created: boolean; source: string } | { error: string }> {
	if (existsSync(join(repoDir, ".git"))) {
		return { created: false, source: repoDir };
	}

	if (existsSync(repoDir)) {
		if (readdirSync(repoDir).length > 0) {
			return { error: `Proposal repo path exists but is not a git clone: ${repoDir}` };
		}
	} else {
		mkdirSync(dirname(repoDir), { recursive: true });
	}

	const localSource = getSystemFlakeDir();
	const cloneSource = existsSync(join(localSource, ".git")) ? localSource : "https://github.com/alexradunet/NixPI.git";
	const clone = await run("git", ["clone", cloneSource, repoDir], signal);
	if (clone.exitCode !== 0) {
		return { error: `Failed to create local proposal repo at ${repoDir}:\n${summarizeOutput(clone)}` };
	}

	return { created: true, source: cloneSource };
}

export async function handleNixConfigProposal(
	action: NixConfigProposalAction,
	signal: AbortSignal | undefined,
	ctx: ExtensionContext,
) {
	const repoDir = PROPOSAL_REPO_DIR;
	const repo = await ensureProposalRepo(repoDir, signal);
	if ("error" in repo) {
		return errorResult(repo.error);
	}

	if (action === "status") {
		const [branch, status, diff] = await Promise.all([
			run("git", ["branch", "--show-current"], signal, repoDir),
			run("git", ["status", "--short"], signal, repoDir),
			run("git", ["diff", "--stat", "--", "flake.nix", "flake.lock", "core/os"], signal, repoDir),
		]);

		const lines = [
			`Local proposal repo: ${repoDir}`,
			...(repo.created ? [`Initialized from: ${repo.source}`, ""] : []),
			`Branch: ${(branch.stdout || branch.stderr).trim() || "(detached or unknown)"}`,
			"",
			"Working tree:",
			status.stdout.trim() || "Clean",
			"",
			"Nix-related diff:",
			diff.stdout.trim() || "No diff in flake.nix, flake.lock, or core/os.",
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
						...(repo.created ? [`Initialized from: ${repo.source}`, ""] : []),
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
		`Validated local NixPI repo at ${repoDir}`,
		...(repo.created ? [`Initialized from: ${repo.source}`, ""] : []),
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
