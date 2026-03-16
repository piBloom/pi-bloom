/** Git remote helpers for the bloom-repo extension. */
import { run } from "./exec.js";

/** Get the URL of a named git remote. Returns null if the remote doesn't exist. */
export async function getRemoteUrl(repoDir: string, remote: string, signal?: AbortSignal): Promise<string | null> {
	const result = await run("git", ["-C", repoDir, "remote", "get-url", remote], signal);
	if (result.exitCode !== 0) return null;
	const url = result.stdout.trim();
	return url || null;
}

/** Infer the upstream repo URL from existing remotes or bootc image metadata. */
export async function inferRepoUrl(repoDir: string, signal?: AbortSignal): Promise<string> {
	const existingUpstream = await getRemoteUrl(repoDir, "upstream", signal);
	if (existingUpstream) return existingUpstream;

	const bootc = await run("bootc", ["status", "--format=json"], signal);
	if (bootc.exitCode === 0) {
		try {
			const status = JSON.parse(bootc.stdout) as {
				status?: { booted?: { image?: { image?: { image?: string } } } };
			};
			const imageRef = status?.status?.booted?.image?.image?.image ?? "";
			const match = imageRef.match(/^ghcr\.io\/([^/]+)\/bloom-os(?:[:@].+)?$/);
			if (match?.[1]) {
				return `https://github.com/${match[1]}/piBloom.git`;
			}
		} catch {
			// fall through
		}
	}

	return "https://github.com/alexradunet/piBloom.git";
}
