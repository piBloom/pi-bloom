/** Validate that a service/unit name matches `bloom-[a-z0-9-]+`. Returns error message or null. */
export function guardBloom(name: string): string | null {
	if (!/^bloom-[a-z0-9][a-z0-9-]*$/.test(name)) {
		return `Security error: name must match bloom-[a-z0-9-]+, got "${name}"`;
	}
	return null;
}

/** Extract `owner/repo` slug from a GitHub URL (HTTPS, SSH, or ssh:// format). Returns null if not a valid GitHub URL. */
export function parseGithubSlugFromUrl(url: string): string | null {
	const trimmed = url.trim();
	const ssh = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
	if (ssh) return `${ssh[1]}/${ssh[2]}`;

	const https = trimmed.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
	if (https) return `${https[1]}/${https[2]}`;

	const sshUrl = trimmed.match(/^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
	if (sshUrl) return `${sshUrl[1]}/${sshUrl[2]}`;

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
