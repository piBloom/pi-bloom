/**
 * Handler / business logic for bloom-repo.
 */
import { mkdirSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import HostedGitInfo from "hosted-git-info";
import { run } from "../../lib/exec.js";
import { getRemoteUrl, inferRepoUrl } from "../../lib/repo.js";
import { errorResult, requireConfirmation } from "../../lib/shared.js";

const bloomDir = join(os.homedir(), ".bloom");
const repoDir = join(bloomDir, "pi-bloom");

/** Extract `owner/repo` slug from a GitHub URL (HTTPS, SSH, or ssh:// format). Returns null if not a valid GitHub URL. */
export function parseGithubSlugFromUrl(url: string): string | null {
	const info = HostedGitInfo.fromUrl(url.trim());
	if (info && info.type === "github") return `${info.user}/${info.project}`;
	return null;
}

/** Convert a string to a safe git branch name segment (lowercase, alphanumeric + hyphens, max 48 chars). */
export function slugifyBranchPart(input: string): string {
	return input
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
}

/** Get the repo directory path. */
export function getRepoDir(): string {
	return repoDir;
}

// --- Configure handler ---

export async function handleConfigure(
	params: {
		repo_url?: string;
		fork_url?: string;
		git_name?: string;
		git_email?: string;
	},
	signal: AbortSignal | undefined,
) {
	mkdirSync(bloomDir, { recursive: true });
	const changes: string[] = [];
	const notes: string[] = [];

	const repoCheck = await run("git", ["-C", repoDir, "rev-parse", "--git-dir"], signal);
	const repoExists = repoCheck.exitCode === 0;
	const upstreamUrl = (params.repo_url?.trim() || (await inferRepoUrl(repoDir, signal))).trim();

	if (!repoExists) {
		const clone = await run("git", ["clone", upstreamUrl, repoDir], signal);
		if (clone.exitCode !== 0) {
			return errorResult(`Failed to clone ${upstreamUrl} into ${repoDir}:\n${clone.stderr}`);
		}
		changes.push(`cloned ${upstreamUrl} -> ${repoDir}`);
	}

	const ensureRepo = await run("git", ["-C", repoDir, "rev-parse", "--git-dir"], signal);
	if (ensureRepo.exitCode !== 0) {
		return errorResult(`No repo clone found at ${repoDir}. Run first-boot setup to clone it.`);
	}

	const currentUpstream = await getRemoteUrl(repoDir, "upstream", signal);
	if (!currentUpstream) {
		const add = await run("git", ["-C", repoDir, "remote", "add", "upstream", upstreamUrl], signal);
		if (add.exitCode !== 0) return errorResult(`Failed to add upstream remote:\n${add.stderr}`);
		changes.push(`remote upstream -> ${upstreamUrl}`);
	} else if (currentUpstream !== upstreamUrl) {
		const set = await run("git", ["-C", repoDir, "remote", "set-url", "upstream", upstreamUrl], signal);
		if (set.exitCode !== 0) return errorResult(`Failed to set upstream remote:\n${set.stderr}`);
		changes.push(`updated upstream: ${currentUpstream} -> ${upstreamUrl}`);
	}

	const currentOrigin = await getRemoteUrl(repoDir, "origin", signal);
	if (params.fork_url?.trim()) {
		const forkUrl = params.fork_url.trim();
		if (!currentOrigin) {
			const add = await run("git", ["-C", repoDir, "remote", "add", "origin", forkUrl], signal);
			if (add.exitCode !== 0) return errorResult(`Failed to add origin remote:\n${add.stderr}`);
			changes.push(`remote origin -> ${forkUrl}`);
		} else if (currentOrigin !== forkUrl) {
			const set = await run("git", ["-C", repoDir, "remote", "set-url", "origin", forkUrl], signal);
			if (set.exitCode !== 0) return errorResult(`Failed to set origin remote:\n${set.stderr}`);
			changes.push(`updated origin: ${currentOrigin} -> ${forkUrl}`);
		}
	} else if (!currentOrigin) {
		const upstreamSlug = parseGithubSlugFromUrl(upstreamUrl);
		const ghAuth = await run("gh", ["auth", "status"], signal);
		if (upstreamSlug && ghAuth.exitCode === 0) {
			const fork = await run(
				"gh",
				["repo", "fork", upstreamSlug, "--remote", "--remote-name", "origin", "--clone=false"],
				signal,
			);
			if (fork.exitCode === 0) {
				changes.push(`created/attached fork remote origin for ${upstreamSlug}`);
			} else {
				notes.push(`Could not auto-create fork with gh: ${fork.stderr.trim()}`);
			}
		} else {
			notes.push("gh auth not available; skipping auto-fork creation.");
		}

		const originAfterFork = await getRemoteUrl(repoDir, "origin", signal);
		if (!originAfterFork) {
			const fallback = await run("git", ["-C", repoDir, "remote", "add", "origin", upstreamUrl], signal);
			if (fallback.exitCode !== 0) return errorResult(`Failed to set fallback origin remote:\n${fallback.stderr}`);
			changes.push(`fallback origin -> ${upstreamUrl}`);
			notes.push("origin currently points to upstream. Set fork_url later for writable PR flow.");
		}
	}

	const hostname = os.hostname();
	const desiredName = params.git_name?.trim() || `Bloom (${hostname})`;
	const desiredEmail = params.git_email?.trim() || `bloom+${hostname}@localhost`;

	const setName = await run("git", ["-C", repoDir, "config", "user.name", desiredName], signal);
	if (setName.exitCode !== 0) return errorResult(`Failed to set git user.name:\n${setName.stderr}`);
	const setEmail = await run("git", ["-C", repoDir, "config", "user.email", desiredEmail], signal);
	if (setEmail.exitCode !== 0) return errorResult(`Failed to set git user.email:\n${setEmail.stderr}`);
	changes.push(`git identity -> ${desiredName} <${desiredEmail}>`);

	const remotes = await run("git", ["-C", repoDir, "remote", "-v"], signal);
	const text = [
		`Repo path: ${repoDir}`,
		changes.length > 0 ? `\nChanges:\n- ${changes.join("\n- ")}` : "\nChanges:\n- (none)",
		`\nRemotes:\n${(remotes.stdout || remotes.stderr).trim() || "(none)"}`,
		notes.length > 0 ? `\nNotes:\n- ${notes.join("\n- ")}` : "",
	].join("\n");
	return { content: [{ type: "text" as const, text: text.trim() }], details: { path: repoDir } };
}

// --- Status handler ---

export async function handleStatus(signal: AbortSignal | undefined) {
	const check = await run("git", ["-C", repoDir, "rev-parse", "--git-dir"], signal);
	if (check.exitCode !== 0) {
		return errorResult(`No repo clone found at ${repoDir}. Run bloom_repo action=configure first.`);
	}
	const branch = await run("git", ["-C", repoDir, "branch", "--show-current"], signal);
	const status = await run("git", ["-C", repoDir, "status", "--short"], signal);
	const log = await run("git", ["-C", repoDir, "log", "--oneline", "-5"], signal);
	const remotes = await run("git", ["-C", repoDir, "remote", "-v"], signal);
	const ghAuth = await run("gh", ["auth", "status"], signal);
	const upstream = await getRemoteUrl(repoDir, "upstream", signal);
	const origin = await getRemoteUrl(repoDir, "origin", signal);
	const upstreamSlug = upstream ? parseGithubSlugFromUrl(upstream) : null;
	const originSlug = origin ? parseGithubSlugFromUrl(origin) : null;

	const ready = upstreamSlug && originSlug && ghAuth.exitCode === 0 ? "yes" : "no";
	const originIsUpstream = upstream && origin && upstream === origin;
	const text = [
		`Path: ${repoDir}`,
		`Branch: ${branch.stdout.trim() || "unknown"}`,
		`PR-ready: ${ready}`,
		`Upstream: ${upstream ?? "(missing)"}`,
		`Origin: ${origin ?? "(missing)"}`,
		originIsUpstream
			? "Warning: origin matches upstream. Configure a writable fork URL for safer fork-based PR flow."
			: "",
		`\nStatus:\n${status.stdout.trim() || "(clean)"}`,
		`\nRemotes:\n${remotes.stdout.trim() || "(none)"}`,
		`\nRecent commits:\n${log.stdout.trim()}`,
		`\nGitHub auth:\n${ghAuth.exitCode === 0 ? "ok" : (ghAuth.stderr || ghAuth.stdout).trim() || "not authenticated"}`,
	].join("\n");
	return {
		content: [{ type: "text" as const, text }],
		details: { path: repoDir, pr_ready: ready === "yes" },
	};
}

// --- Sync handler ---

export async function handleSync(branch: string, signal: AbortSignal | undefined) {
	const check = await run("git", ["-C", repoDir, "rev-parse", "--git-dir"], signal);
	if (check.exitCode !== 0)
		return errorResult(`No repo clone found at ${repoDir}. Run bloom_repo action=configure first.`);

	const fetch = await run("git", ["-C", repoDir, "fetch", "upstream", "--prune"], signal);
	if (fetch.exitCode !== 0) {
		return errorResult(`Failed to fetch upstream:\n${fetch.stderr || fetch.stdout}`);
	}

	const checkout = await run("git", ["-C", repoDir, "checkout", branch], signal);
	if (checkout.exitCode !== 0) {
		return errorResult(`Failed to checkout ${branch}:\n${checkout.stderr || checkout.stdout}`);
	}

	const pull = await run("git", ["-C", repoDir, "pull", "--ff-only", "upstream", branch], signal);
	if (pull.exitCode !== 0) {
		return errorResult(`Failed to fast-forward ${branch} from upstream:\n${pull.stderr || pull.stdout}`);
	}

	const short = await run("git", ["-C", repoDir, "rev-parse", "--short", "HEAD"], signal);
	const text = `Synced ${branch} from upstream. HEAD: ${short.stdout.trim() || "unknown"}`;
	return { content: [{ type: "text" as const, text }], details: { path: repoDir, branch } };
}

// --- Submit PR handler ---

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

	if (nowBranch !== targetBranch) {
		const checkout = await run("git", ["-C", repoDir, "checkout", "-B", targetBranch], signal);
		if (checkout.exitCode !== 0) {
			return errorResult(`Failed to switch to branch ${targetBranch}:\n${checkout.stderr || checkout.stdout}`);
		}
	}

	if (params.add_all ?? true) {
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
