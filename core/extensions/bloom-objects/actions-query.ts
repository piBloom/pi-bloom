/**
 * Query handlers for bloom-objects: list and search.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getBloomDir, safePath } from "../../lib/filesystem.js";
import { parseFrontmatter } from "../../lib/frontmatter.js";
import { errorResult, truncate } from "../../lib/shared.js";
import { walkMdFiles } from "./actions.js";

/** List objects, optionally filtered by type or frontmatter fields. */
export function listObjects(
	params: { type?: string; directory?: string; filters?: Record<string, string> },
	signal?: AbortSignal,
) {
	const bloomDir = getBloomDir();
	const filters = params.filters ?? {};
	const results: string[] = [];

	let dir: string;
	if (params.directory) {
		try {
			dir = safePath(os.homedir(), params.directory);
		} catch {
			return errorResult("Path traversal blocked: invalid directory");
		}
	} else {
		dir = path.join(bloomDir, "Objects");
	}

	for (const filepath of walkMdFiles(dir)) {
		if (signal?.aborted) break;
		try {
			const raw = fs.readFileSync(filepath, "utf-8");
			const { attributes } = parseFrontmatter<Record<string, unknown>>(raw);
			const type = String(attributes.type ?? "note");
			if (params.type && type !== params.type) continue;

			let match = true;
			for (const [key, val] of Object.entries(filters)) {
				if (key === "tag") {
					const tags = Array.isArray(attributes.tags) ? attributes.tags : [];
					if (!(tags as string[]).includes(val)) {
						match = false;
						break;
					}
				} else {
					if (String(attributes[key] ?? "") !== val) {
						match = false;
						break;
					}
				}
			}
			if (!match) continue;

			const slug = String(attributes.slug ?? "unknown");
			const title = attributes.title ? ` — ${attributes.title}` : "";
			results.push(`${type}/${slug}${title}`);
		} catch {
			// Skip unreadable files
		}
	}

	const text = results.length > 0 ? results.join("\n") : "No objects found";
	return {
		content: [{ type: "text" as const, text: truncate(text) }],
		details: {},
	};
}

/** Search markdown files in ~/Bloom/ for a pattern. */
export function searchObjects(params: { pattern: string }, signal?: AbortSignal) {
	const bloomDir = getBloomDir();
	const matches: string[] = [];

	const files = fs.globSync("**/*.md", { cwd: bloomDir });
	for (const file of files) {
		if (signal?.aborted) break;
		try {
			const filepath = path.join(bloomDir, file);
			const raw = fs.readFileSync(filepath, "utf-8");
			if (!raw.includes(params.pattern)) continue;
			const { attributes } = parseFrontmatter<Record<string, unknown>>(raw);
			const type = String(attributes.type ?? "note");
			const slug = String(attributes.slug ?? path.basename(filepath, ".md"));
			const ref = `${type}/${slug}`;
			const title = attributes.title ? ` — ${attributes.title}` : "";
			matches.push(`${ref}${title}`);
		} catch {
			// Skip unreadable files
		}
	}

	const text = matches.length > 0 ? matches.join("\n") : "No matches found";
	return {
		content: [{ type: "text" as const, text: truncate(text) }],
		details: {},
	};
}
