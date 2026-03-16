/** Git remote helpers for the bloom-repo extension. */
import { run } from "./exec.js";

/** Get the URL of a named git remote. Returns null if the remote doesn't exist. */
export async function getRemoteUrl(repoDir: string, remote: string, signal?: AbortSignal): Promise<string | null> {
	const result = await run("git", ["-C", repoDir, "remote", "get-url", remote], signal);
	if (result.exitCode !== 0) return null;
	const url = result.stdout.trim();
	return url || null;
}

/** Infer the upstream repo URL from existing remotes. */
export async function inferRepoUrl(repoDir: string, signal?: AbortSignal): Promise<string> {
	const existingUpstream = await getRemoteUrl(repoDir, "upstream", signal);
	if (existingUpstream) return existingUpstream;

	const origin = await getRemoteUrl(repoDir, "origin", signal);
	if (origin) return origin;

	return "https://github.com/alexradunet/piBloom.git";
}
