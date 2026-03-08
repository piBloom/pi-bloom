import os from "node:os";
import path from "node:path";

/**
 * Resolve path segments under a root directory, blocking path traversal.
 * Throws if the resolved path escapes the root.
 */
export function safePath(root: string, ...segments: string[]): string {
	const resolved = path.resolve(root, ...segments);
	const normalRoot = path.resolve(root);
	if (!resolved.startsWith(normalRoot + path.sep) && resolved !== normalRoot) {
		throw new Error(`Path traversal blocked: ${segments.join("/")} escapes ${root}`);
	}
	return resolved;
}

/** Resolve the Bloom directory. Checks `_BLOOM_DIR_RESOLVED`, then `BLOOM_DIR`, then falls back to `~/Bloom`. */
export function getBloomDir(): string {
	return process.env._BLOOM_DIR_RESOLVED ?? process.env.BLOOM_DIR ?? path.join(os.homedir(), "Bloom");
}
