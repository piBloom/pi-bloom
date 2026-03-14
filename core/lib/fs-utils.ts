import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Ensure a directory exists. */
export function ensureDir(dir: string, mode?: number): void {
	if (existsSync(dir)) return;
	mkdirSync(dir, { recursive: true, ...(mode ? { mode } : {}) });
}

/** Write a file atomically via temporary sibling + rename. */
export function atomicWriteFile(filePath: string, content: string, mode?: number): void {
	ensureDir(path.dirname(filePath), mode);
	const tmpPath = `${filePath}.tmp`;
	writeFileSync(tmpPath, content, "utf-8");
	renameSync(tmpPath, filePath);
}

/** Parse JSON from disk with a fallback when the file is absent or invalid. */
export function readJsonFile<T>(filePath: string, fallback: T): T {
	try {
		return JSON.parse(readFileSync(filePath, "utf-8")) as T;
	} catch {
		return fallback;
	}
}

/**
 * Resolve a path under a root directory and reject traversal, including
 * escaping through existing symlinks.
 */
export function safePathWithin(root: string, ...segments: string[]): string {
	const resolvedRoot = path.resolve(root);
	const resolvedPath = path.resolve(resolvedRoot, ...segments);
	if (segments.length === 0) return resolvedRoot;

	if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
		throw new Error(`Path traversal blocked: ${segments.join("/")} escapes ${root}`);
	}

	const existingRoot = existsSync(resolvedRoot) ? realpathSync(resolvedRoot) : resolvedRoot;
	const existingParent = existsSync(path.dirname(resolvedPath))
		? realpathSync(path.dirname(resolvedPath))
		: path.dirname(resolvedPath);
	const existingTarget = existsSync(resolvedPath) ? realpathSync(resolvedPath) : resolvedPath;

	for (const candidate of [existingParent, existingTarget]) {
		if (candidate !== existingRoot && !candidate.startsWith(`${existingRoot}${path.sep}`)) {
			throw new Error(`Path traversal blocked: ${segments.join("/")} escapes ${root}`);
		}
	}

	return resolvedPath;
}
