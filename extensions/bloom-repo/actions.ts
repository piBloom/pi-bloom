/**
 * Handler / business logic for bloom-repo.
 * Status, sync, and shared helpers.
 */
import os from "node:os";
import { join } from "node:path";
import { run } from "../../core/lib/exec.js";
import { parseGithubSlugFromUrl } from "../../core/lib/git.js";
import { getRemoteUrl } from "../../core/lib/repo.js";
import { errorResult } from "../../core/lib/shared.js";

const bloomDir = join(os.homedir(), ".bloom");
const repoDir = join(bloomDir, "pi-bloom");

/** Get the repo directory path. */
export function getRepoDir(): string {
	return repoDir;
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
