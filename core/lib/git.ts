/**
 * Git utilities shared across extensions.
 */
import HostedGitInfo from "hosted-git-info";

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
