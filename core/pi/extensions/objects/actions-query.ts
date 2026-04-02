/**
 * Query handlers for objects: list and search.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getNixPiDir, safePath } from "../../../lib/filesystem.js";
import { parseFrontmatter } from "../../../lib/frontmatter.js";
import { errorResult, textToolResult, truncate } from "../../../lib/utils.js";
import { walkMdFiles } from "./actions.js";
import { readMemoryRecord, type ScopePreference, scoreRecord } from "./memory.js";

function resolveObjectsDir(directory?: string) {
	if (!directory) return { dir: path.join(getNixPiDir(), "Objects") };
	try {
		return { dir: safePath(os.homedir(), directory) };
	} catch {
		return { error: errorResult("Path traversal blocked: invalid directory") };
	}
}

function matchesObjectFilters(
	attributes: Record<string, unknown>,
	type: string | undefined,
	filters: Record<string, string>,
): boolean {
	if (type && String(attributes.type ?? "note") !== type) return false;
	return Object.entries(filters).every(([key, val]) => {
		if (key === "tag") {
			const tags = Array.isArray(attributes.tags) ? attributes.tags : [];
			return (tags as string[]).includes(val);
		}
		return String(attributes[key] ?? "") === val;
	});
}

function formatObjectListEntry(attributes: Record<string, unknown>): string {
	const type = String(attributes.type ?? "note");
	const slug = String(attributes.slug ?? "unknown");
	const title = attributes.title ? ` — ${attributes.title}` : "";
	return `${type}/${slug}${title}`;
}

/** List objects, optionally filtered by type or frontmatter fields. */
export function listObjects(
	params: { type?: string; directory?: string; filters?: Record<string, string> },
	signal?: AbortSignal,
) {
	const filters = params.filters ?? {};
	const results: string[] = [];
	const resolved = resolveObjectsDir(params.directory);
	if (resolved.error) return resolved.error;

	for (const filepath of walkMdFiles(resolved.dir)) {
		if (signal?.aborted) break;
		try {
			const raw = fs.readFileSync(filepath, "utf-8");
			const { attributes } = parseFrontmatter<Record<string, unknown>>(raw);
			if (!matchesObjectFilters(attributes, params.type, filters)) continue;
			results.push(formatObjectListEntry(attributes));
		} catch {
			// Skip unreadable files
		}
	}

	const text = results.length > 0 ? results.join("\n") : "No objects found";
	return textToolResult(truncate(text));
}

/** Search markdown files in ~/nixpi/ for a pattern. */
export function searchObjects(params: { pattern: string }, signal?: AbortSignal) {
	const workspaceDir = getNixPiDir();
	const matches: string[] = [];

	const files = fs.globSync("**/*.md", { cwd: workspaceDir });
	for (const file of files) {
		if (signal?.aborted) break;
		try {
			const filepath = path.join(workspaceDir, file);
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
	return textToolResult(truncate(text));
}

/** Query ranked object matches from ~/nixpi/Objects/. */
export function queryObjects(
	params: {
		text?: string;
		type?: string;
		tags?: string[];
		scope?: string;
		scope_value?: string;
		status?: string;
		link_to?: string;
		preferred_scopes?: ScopePreference[];
		limit?: number;
	},
	signal?: AbortSignal,
) {
	const workspaceDir = getNixPiDir();
	const dir = path.join(workspaceDir, "Objects");
	const limit = Math.max(1, Math.min(100, Number(params.limit ?? 10)));
	const results = [];

	for (const filepath of walkMdFiles(dir)) {
		if (signal?.aborted) break;
		const record = readMemoryRecord(filepath);
		if (!record) continue;
		const scored = scoreRecord(record, params);
		if (!scored) continue;
		results.push(scored);
	}

	results.sort((a, b) => b.score - a.score || a.ref.localeCompare(b.ref));
	const top = results.slice(0, limit);
	const text =
		top.length > 0
			? top
					.map((result) => {
						const title = result.title ? ` — ${result.title}` : "";
						const summary = result.summary ? `\n  ${result.summary}` : "";
						return `${result.ref}${title} [score=${result.score}; ${result.reasons.join(", ")}]${summary}`;
					})
					.join("\n")
			: "No matching objects found";

	return textToolResult(truncate(text), { count: top.length, results: top });
}
