/**
 * Handler / business logic for objects.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getNixPiDir, safePath } from "../../../lib/filesystem.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../../lib/frontmatter.js";
import { errorResult, nowIso, textToolResult, truncate } from "../../../lib/utils.js";
import { defaultObjectBody, mergeObjectState, readMemoryRecord, writeMemoryRecord } from "./memory.js";

/** Parse a `type/slug` reference string into its components. Throws if format is invalid. */
export function parseRef(ref: string): { type: string; slug: string } {
	const slash = ref.indexOf("/");
	if (slash === -1) throw new Error(`invalid reference format: '${ref}' (expected type/slug)`);
	return { type: ref.slice(0, slash), slug: ref.slice(slash + 1) };
}

/** Walk a directory recursively for .md files. */
export function walkMdFiles(dir: string): string[] {
	if (!fs.existsSync(dir)) return [];
	return fs.globSync("**/*.md", { cwd: dir }).map((f) => path.join(dir, f));
}

/** Create a new markdown object. */
export function createObject(params: {
	type: string;
	slug: string;
	fields?: Record<string, unknown>;
	path?: string;
	body?: string;
}) {
	const workspaceDir = getNixPiDir();
	let filepath: string;
	try {
		filepath = params.path
			? safePath(os.homedir(), params.path)
			: safePath(workspaceDir, "Objects", `${params.slug}.md`);
	} catch {
		return errorResult("Path traversal blocked: invalid path");
	}
	fs.mkdirSync(path.dirname(filepath), { recursive: true });

	const data = mergeObjectState({ type: params.type, slug: params.slug, fields: params.fields });
	const body = params.body ?? defaultObjectBody(data);

	try {
		fs.writeFileSync(filepath, stringifyFrontmatter(data, body), {
			flag: "wx",
		});
	} catch (err: unknown) {
		if ((err as NodeJS.ErrnoException).code === "EEXIST") {
			return errorResult(`object already exists: ${params.type}/${params.slug}`);
		}
		return errorResult(`failed to create object: ${(err as Error).message}`);
	}

	return textToolResult(`created ${params.type}/${params.slug}`);
}

export function updateObject(params: {
	type: string;
	slug: string;
	fields?: Record<string, unknown>;
	path?: string;
	body?: string;
}) {
	let filepath: string;
	if (params.path) {
		try {
			filepath = safePath(os.homedir(), params.path);
		} catch {
			return errorResult("Path traversal blocked: invalid path");
		}
	} else {
		const workspaceDir = getNixPiDir();
		try {
			filepath = safePath(path.join(workspaceDir, "Objects"), `${params.slug}.md`);
		} catch {
			return errorResult("Path traversal blocked: invalid slug");
		}
	}
	const record = readMemoryRecord(filepath);
	if (!record) return errorResult(`object not found: ${params.type}/${params.slug}`);
	const attributes = mergeObjectState({
		type: params.type,
		slug: params.slug,
		fields: params.fields,
		existing: record.attributes,
	});
	writeMemoryRecord({
		filepath,
		attributes,
		body: params.body ?? record.body,
	});
	return textToolResult(`updated ${params.type}/${params.slug}`);
}

export function upsertObject(params: {
	type: string;
	slug: string;
	fields?: Record<string, unknown>;
	path?: string;
	body?: string;
}) {
	const workspaceDir = getNixPiDir();
	let filepath: string;
	try {
		filepath = params.path
			? safePath(os.homedir(), params.path)
			: safePath(path.join(workspaceDir, "Objects"), `${params.slug}.md`);
	} catch {
		return errorResult("Path traversal blocked: invalid path");
	}
	const existing = readMemoryRecord(filepath);
	if (!existing) {
		return createObject(params);
	}
	const attributes = mergeObjectState({
		type: params.type,
		slug: params.slug,
		fields: params.fields,
		existing: existing.attributes,
	});
	writeMemoryRecord({
		filepath,
		attributes,
		body: params.body ?? existing.body,
	});
	return textToolResult(`upserted ${params.type}/${params.slug}`, { existed: true });
}

/** Read a markdown object. */
export function readObject(params: { type: string; slug: string; path?: string }) {
	let filepath: string;
	if (params.path) {
		try {
			filepath = safePath(os.homedir(), params.path);
		} catch {
			return errorResult("Path traversal blocked: invalid path");
		}
	} else {
		const workspaceDir = getNixPiDir();
		try {
			filepath = safePath(path.join(workspaceDir, "Objects"), `${params.slug}.md`);
		} catch {
			return errorResult("Path traversal blocked: invalid slug");
		}
	}

	if (!fs.existsSync(filepath)) {
		return errorResult(`object not found: ${params.type}/${params.slug}`);
	}
	const raw = fs.readFileSync(filepath, "utf-8");
	try {
		const { attributes, body } = parseFrontmatter<Record<string, unknown>>(raw);
		const updated = {
			...attributes,
			last_accessed: nowIso(),
		};
		fs.writeFileSync(filepath, stringifyFrontmatter(updated, body));
	} catch {
		// Leave unreadable files untouched.
	}
	return textToolResult(truncate(raw));
}

/** Add bidirectional links between two objects. */
export function linkObjects(params: { ref_a: string; ref_b: string }) {
	const workspaceDir = getNixPiDir();
	const a = parseRef(params.ref_a);
	const b = parseRef(params.ref_b);
	let pathA: string;
	let pathB: string;
	try {
		pathA = safePath(path.join(workspaceDir, "Objects"), `${a.slug}.md`);
		pathB = safePath(path.join(workspaceDir, "Objects"), `${b.slug}.md`);
	} catch {
		return errorResult("Path traversal blocked: invalid slug");
	}

	if (!fs.existsSync(pathA)) return errorResult(`object not found: ${params.ref_a}`);
	if (!fs.existsSync(pathB)) return errorResult(`object not found: ${params.ref_b}`);

	function addLink(fp: string, linkRef: string): void {
		const raw = fs.readFileSync(fp, "utf-8");
		const { attributes, body } = parseFrontmatter<Record<string, unknown>>(raw);
		const links: string[] = Array.isArray(attributes.links) ? [...(attributes.links as string[])] : [];
		if (!links.includes(linkRef)) {
			links.push(linkRef);
			attributes.links = links;
			fs.writeFileSync(fp, stringifyFrontmatter(attributes, body));
		}
	}

	addLink(pathA, params.ref_b);
	addLink(pathB, params.ref_a);

	return textToolResult(`linked ${params.ref_a} <-> ${params.ref_b}`);
}
