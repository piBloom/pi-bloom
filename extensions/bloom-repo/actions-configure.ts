/**
 * Configure handler for bloom-repo.
 */
import { mkdirSync } from "node:fs";
import os from "node:os";
import { dirname } from "node:path";
import { run } from "../../core/lib/exec.js";
import { parseGithubSlugFromUrl } from "../../core/lib/git.js";
import { getRemoteUrl, inferRepoUrl } from "../../core/lib/repo.js";
import { errorResult } from "../../core/lib/shared.js";
import { getRepoDir } from "./actions.js";

export async function handleConfigure(
	params: {
		repo_url?: string;
		fork_url?: string;
		git_name?: string;
		git_email?: string;
	},
	signal: AbortSignal | undefined,
) {
	const repoDir = getRepoDir();
	mkdirSync(dirname(repoDir), { recursive: true });
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
