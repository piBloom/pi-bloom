import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateHead } from "@mariozechner/pi-coding-agent";

const require = createRequire(import.meta.url);
const matter: (
	str: string,
	opts?: Record<string, unknown>,
) => {
	data: Record<string, unknown>;
	content: string;
	matter: string;
} = require("@11ty/gray-matter");
const jsYaml: {
	load: (str: string) => unknown;
	dump: (obj: unknown, opts?: Record<string, unknown>) => string;
	JSON_SCHEMA: unknown;
} = require("js-yaml");

/** Centralized js-yaml import via createRequire (avoids ESM/CJS interop issues). */
export const yaml: { load: (str: string) => unknown; dump: (obj: unknown) => string } = jsYaml;

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

/** Result of parsing YAML frontmatter from a markdown string. */
export interface ParsedFrontmatter<T> {
	attributes: T;
	body: string;
	bodyBegin: number;
	frontmatter: string;
}

/** Resolve the Bloom directory. Checks `_BLOOM_DIR_RESOLVED`, then `BLOOM_DIR`, then falls back to `~/Bloom`. */
export function getBloomDir(): string {
	return process.env._BLOOM_DIR_RESOLVED ?? process.env.BLOOM_DIR ?? path.join(os.homedir(), "Bloom");
}

/** Truncate text to 2000 lines / 50KB using Pi's truncateHead utility. */
export function truncate(text: string): string {
	return truncateHead(text, { maxLines: 2000, maxBytes: 50000 }).content;
}

/** Build a standardized Pi tool error response. */
export function errorResult(message: string) {
	return {
		content: [{ type: "text" as const, text: message }],
		details: {},
		isError: true,
	};
}

/** Prompt the user for confirmation via UI. Returns null if confirmed, error message if declined or no UI. */
export async function requireConfirmation(
	ctx: ExtensionContext,
	action: string,
	options?: { requireUi?: boolean },
): Promise<string | null> {
	const requireUi = options?.requireUi ?? true;
	if (!ctx.hasUI) {
		return requireUi ? `Cannot perform "${action}" without interactive user confirmation.` : null;
	}
	const confirmed = await ctx.ui.confirm("Confirm action", `Allow: ${action}?`);
	if (!confirmed) return `User declined: ${action}`;
	return null;
}

/** Return current time as ISO 8601 string without milliseconds (e.g., `2026-03-06T12:00:00Z`). */
export function nowIso(): string {
	return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Serialize a data object and markdown body into a frontmatter-delimited string. */
export function stringifyFrontmatter(data: Record<string, unknown>, content: string): string {
	const keys = Object.keys(data);
	if (keys.length === 0) return `---\n---\n${content}`;
	const yamlStr = jsYaml.dump(data, { schema: jsYaml.JSON_SCHEMA }).trimEnd();
	return `---\n${yamlStr}\n---\n${content}`;
}

/** Parse YAML frontmatter from a markdown string. Returns attributes, body, and metadata. Supports comma-separated arrays and YAML-style list arrays. */
export function parseFrontmatter<T extends Record<string, unknown> = Record<string, unknown>>(
	str: string,
): ParsedFrontmatter<T> {
	const empty: ParsedFrontmatter<T> = { attributes: {} as T, body: str, bodyBegin: 1, frontmatter: "" };
	if (!str.startsWith("---\n")) return empty;
	if (str.indexOf("\n---\n", 4) === -1 && !str.match(/\n---$/)) return empty;

	let result: { data: Record<string, unknown>; content: string; matter: string };
	try {
		result = matter(str, { schema: jsYaml.JSON_SCHEMA });
	} catch {
		return empty;
	}
	const attributes = result.data as Record<string, unknown>;

	// Compat layer: split comma-separated strings into arrays for known keys
	for (const key of FRONTMATTER_ARRAY_KEYS) {
		const val = attributes[key];
		if (typeof val === "string" && val.includes(",")) {
			attributes[key] = val
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean);
		}
	}

	const frontmatter = result.matter.trimStart();
	const bodyBegin = frontmatter.split("\n").length + 3;
	return {
		attributes: attributes as T,
		body: result.content,
		bodyBegin,
		frontmatter,
	};
}

/** Resolve the OCI service registry. Checks `BLOOM_SERVICE_REGISTRY`, then `BLOOM_REGISTRY`, then falls back to `ghcr.io/pibloom`. */
export function getServiceRegistry(): string {
	return process.env.BLOOM_SERVICE_REGISTRY?.trim() || process.env.BLOOM_REGISTRY?.trim() || "ghcr.io/pibloom";
}

/** Frontmatter keys that are parsed as comma-separated arrays. */
const FRONTMATTER_ARRAY_KEYS = new Set(["tags", "links", "aliases"]);

type LogLevel = "debug" | "info" | "warn" | "error";

/** Create a structured JSON logger for a named component. Outputs to stdout/stderr with timestamp, level, component, and message. */
export function createLogger(component: string) {
	function log(level: LogLevel, msg: string, extra?: Record<string, unknown>): void {
		const entry: Record<string, unknown> = {
			ts: new Date().toISOString(),
			level,
			component,
			msg,
			...extra,
		};
		const line = JSON.stringify(entry);
		if (level === "error") {
			console.error(line);
		} else if (level === "warn") {
			console.warn(line);
		} else {
			console.log(line);
		}
	}

	return {
		debug: (msg: string, extra?: Record<string, unknown>) => log("debug", msg, extra),
		info: (msg: string, extra?: Record<string, unknown>) => log("info", msg, extra),
		warn: (msg: string, extra?: Record<string, unknown>) => log("warn", msg, extra),
		error: (msg: string, extra?: Record<string, unknown>) => log("error", msg, extra),
	};
}

/** Validate that a service/unit name matches `bloom-[a-z0-9-]+`. Returns error message or null. */
export function guardBloom(name: string): string | null {
	if (!/^bloom-[a-z0-9][a-z0-9-]*$/.test(name)) {
		return `Security error: name must match bloom-[a-z0-9-]+, got "${name}"`;
	}
	return null;
}
