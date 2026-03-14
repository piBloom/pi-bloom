/** Safe filesystem operations: path traversal protection, temp dirs, and home resolution. */
import os from "node:os";
import path from "node:path";
import { safePathWithin } from "./fs-utils.js";

/**
 * Resolve path segments under a root directory, blocking path traversal.
 * Throws if the resolved path escapes the root.
 */
export function safePath(root: string, ...segments: string[]): string {
	return safePathWithin(root, ...segments);
}

/** Resolve the Bloom directory. Checks `BLOOM_DIR` env var, then falls back to `~/Bloom`. */
export function getBloomDir(): string {
	return process.env.BLOOM_DIR ?? path.join(os.homedir(), "Bloom");
}

/** Path to the user's Quadlet unit directory for rootless containers. */
export function getQuadletDir(): string {
	return path.join(os.homedir(), ".config", "containers", "systemd");
}

/** Path to the OS update status file written by the update-check timer. */
export function getUpdateStatusPath(): string {
	return path.join(os.homedir(), ".bloom", "update-status.json");
}
