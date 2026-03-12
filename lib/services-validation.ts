/** Validation helpers for service names, image references, and command availability. */
import { existsSync, readFileSync } from "node:fs";
import { run } from "./exec.js";

/**
 * Check whether a `/etc/subuid` or `/etc/subgid` file contains an entry
 * for the given username.
 *
 * Each line in these files has the format `username:start:count`.
 * Returns `true` if any line starts with `username:`.
 *
 * @param filePath - Path to the subid file (e.g. `/etc/subuid`).
 * @param username - OS username to look for.
 * @returns `true` if the user has a subordinate ID range in the file.
 */
export function hasSubidRange(filePath: string, username: string): boolean {
	if (!existsSync(filePath)) return false;
	try {
		return readFileSync(filePath, "utf-8")
			.split("\n")
			.some((line) => line.trim().startsWith(`${username}:`));
	} catch {
		return false;
	}
}

/** Validate that a service name is kebab-case `[a-z0-9-]`. Returns error message or null. */
export function validateServiceName(name: string): string | null {
	if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
		return "Service name must be kebab-case using [a-z0-9-].";
	}
	return null;
}

/** Validate that a container image reference is pinned (digest or explicit non-latest tag). Returns error message or null. */
export function validatePinnedImage(image: string): string | null {
	if (image.includes("@sha256:")) return null;
	const tagMatch = image.match(/:([^/@]+)$/);
	if (!tagMatch) {
		return "Image must include an explicit version tag or digest (avoid implicit latest).";
	}
	const tag = tagMatch[1].toLowerCase();
	if (tag === "latest" || tag.startsWith("latest-")) {
		return "Image tag must be pinned (avoid latest/latest-* tags).";
	}
	return null;
}

/** Check whether a CLI command is available on this system. */
export async function commandExists(cmd: string, signal?: AbortSignal): Promise<boolean> {
	if (!/^[a-zA-Z0-9._+-]+$/.test(cmd)) return false;
	const check = await run(cmd, ["--version"], signal);
	if (check.exitCode === 0) return true;
	return !/ENOENT|not found|No such file/i.test(check.stderr || check.stdout);
}
