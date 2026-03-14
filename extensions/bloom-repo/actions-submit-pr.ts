/**
 * Submit PR handler for bloom-repo.
 */
import os from "node:os";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { run } from "../../core/lib/exec.js";
import { parseGithubSlugFromUrl, slugifyBranchPart } from "../../core/lib/git.js";
import { getRemoteUrl } from "../../core/lib/repo.js";
import { errorResult, requireConfirmation } from "../../core/lib/shared.js";
import { getRepoDir } from "./actions.js";

export async function handleSubmitPr(
	params: {
		title: string;
		body?: string;
		commit_message?: string;
		branch?: string;
		base?: string;
		draft?: boolean;
		add_all?: boolean;
	},
	signal: AbortSignal | undefined,
	ctx: ExtensionContext,
) {
	const repoDir = getRepoDir();
	const denied = await requireConfirmation(ctx, `Create pull request "${params.title}" from local Bloom repo changes`, {
		requireUi: false,
	});
	if (denied) return errorResult(denied);

	const check = await run("git", ["-C", repoDir, "rev-parse", "--git-dir"], signal);
	if (check.exitCode !== 0)
		return errorResult(`No repo clone found at ${repoDir}. Run bloom_repo action=configure first.`);

	const ghAuth = await run("gh", ["auth", "status"], signal);
	if (ghAuth.exitCode !== 0) {
		return errorResult(`GitHub auth is not ready. Run gh auth login first.\n${ghAuth.stderr || ghAuth.stdout}`);
	}

	const upstreamUrl = await getRemoteUrl(repoDir, "upstream", signal);
	const originUrl = await getRemoteUrl(repoDir, "origin", signal);
	if (!upstreamUrl) return errorResult("Missing upstream remote. Run bloom_repo action=configure first.");
	if (!originUrl) return errorResult("Missing origin remote. Run bloom_repo action=configure with fork_url first.");

	const upstreamSlug = parseGithubSlugFromUrl(upstreamUrl);
	const originSlug = parseGithubSlugFromUrl(originUrl);
	if (!upstreamSlug) return errorResult(`Cannot parse upstream GitHub slug from ${upstreamUrl}`);

	const base = (params.base ?? "main").trim() || "main";
	const currentBranch = await run("git", ["-C", repoDir, "branch", "--show-current"], signal);
	const nowBranch = currentBranch.stdout.trim() || "main";
	const defaultBranch = `node/${slugifyBranchPart(os.hostname())}/${slugifyBranchPart(params.title) || "fix"}`;
	const targetBranch = (params.branch?.trim() || (nowBranch === base ? defaultBranch : nowBranch)).trim();

	if (!(params.add_all ?? false)) {
		const dirty = await run("git", ["-C", repoDir, "status", "--short"], signal);
		const unstaged = dirty.stdout
			.split("\n")
			.map((line) => line.trimEnd())
			.filter(Boolean)
			.filter(
				(line) => !line.startsWith("A ") && !line.startsWith("M ") && !line.startsWith("R ") && !line.startsWith("C "),
			);
		if (unstaged.length > 0) {
			return errorResult(
				[
					"Refusing to auto-submit PR with unstaged or untracked changes.",
					"Stage only the intended files first, or retry with add_all=true.",
					"",
					unstaged.join("\n"),
				].join("\n"),
			);
		}
	}

	if (nowBranch !== targetBranch) {
		const checkout = await run("git", ["-C", repoDir, "checkout", "-B", targetBranch], signal);
		if (checkout.exitCode !== 0) {
			return errorResult(`Failed to switch to branch ${targetBranch}:\n${checkout.stderr || checkout.stdout}`);
		}
	}

	if (params.add_all ?? false) {
		const add = await run("git", ["-C", repoDir, "add", "-A"], signal);
		if (add.exitCode !== 0) {
			return errorResult(`Failed to stage changes:\n${add.stderr || add.stdout}`);
		}
	}

	const staged = await run("git", ["-C", repoDir, "diff", "--cached", "--name-only"], signal);
	if (!staged.stdout.trim()) {
		return errorResult("No staged changes found. Make edits first, then retry bloom_repo_submit_pr.");
	}

	const commitMessage = (params.commit_message?.trim() || `fix: ${params.title}`).trim();
	const commit = await run("git", ["-C", repoDir, "commit", "-m", commitMessage], signal);
	if (commit.exitCode !== 0) {
		return errorResult(`Failed to commit changes:\n${commit.stderr || commit.stdout}`);
	}

	const push = await run("git", ["-C", repoDir, "push", "--set-upstream", "origin", targetBranch], signal);
	if (push.exitCode !== 0) {
		return errorResult(`Failed to push branch ${targetBranch} to origin:\n${push.stderr || push.stdout}`);
	}

	const originOwner = originSlug?.split("/")[0] ?? null;
	const headRef = originOwner && originSlug !== upstreamSlug ? `${originOwner}:${targetBranch}` : targetBranch;
	const body =
		params.body?.trim() ||
		["## Summary", params.title, "", "## Source", `Submitted from Bloom device: ${os.hostname()}`].join("\n");

	const prArgs = [
		"pr",
		"create",
		"--repo",
		upstreamSlug,
		"--base",
		base,
		"--head",
		headRef,
		"--title",
		params.title,
		"--body",
		body,
	];
	if (params.draft) prArgs.push("--draft");

	const pr = await run("gh", prArgs, signal);
	let prUrl = pr.stdout.trim();
	if (pr.exitCode !== 0) {
		const existing = await run(
			"gh",
			["pr", "list", "--repo", upstreamSlug, "--state", "open", "--head", headRef, "--json", "url", "-q", ".[0].url"],
			signal,
		);
		if (existing.exitCode === 0 && existing.stdout.trim()) {
			prUrl = existing.stdout.trim();
		} else {
			return errorResult(`Failed to create PR:\n${pr.stderr || pr.stdout}`);
		}
	}

	const files = staged.stdout
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((f) => `- ${f}`)
		.join("\n");

	const text = [
		`PR ready: ${prUrl || "(URL unavailable)"}`,
		`Branch: ${targetBranch}`,
		`Base: ${base}`,
		"",
		"Files:",
		files || "- (unknown)",
	].join("\n");

	return {
		content: [{ type: "text" as const, text }],
		details: { path: repoDir, branch: targetBranch, base, pr_url: prUrl || null },
	};
}
