/**
 * Handler / business logic for bloom-objects.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getBloomDir, safePath } from "../../lib/filesystem.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../lib/frontmatter.js";
import { errorResult, nowIso, truncate } from "../../lib/shared.js";

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

function parseFieldValue(key: string, val: string): unknown {
	return key === "tags" || key === "links"
		? val
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean)
		: val;
}

/** Create a new markdown object. */
export function createObject(params: { type: string; slug: string; fields?: Record<string, string>; path?: string }) {
	const bloomDir = getBloomDir();
	let filepath: string;
	try {
		filepath = params.path ? safePath(os.homedir(), params.path) : safePath(bloomDir, "Objects", `${params.slug}.md`);
	} catch {
		return errorResult("Path traversal blocked: invalid path");
	}
	fs.mkdirSync(path.dirname(filepath), { recursive: true });

	const fields = params.fields ?? {};
	const now = nowIso();
	const data: Record<string, unknown> = {
		type: params.type,
		slug: params.slug,
	};

	// Add known fields first for consistent ordering, then remaining fields sorted
	for (const k of ["title", "status", "priority"]) {
		if (k in fields) data[k] = fields[k];
	}
	for (const k of Object.keys(fields).sort()) {
		if (k in data) continue;
		data[k] = parseFieldValue(k, fields[k]);
	}
	data.origin = "pi";
	data.created = now;
	data.modified = now;

	const title = data.title as string | undefined;
	const body = title ? `# ${title}\n` : "";

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

	return {
		content: [
			{
				type: "text" as const,
				text: `created ${params.type}/${params.slug}`,
			},
		],
		details: {},
	};
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
		const bloomDir = getBloomDir();
		try {
			filepath = safePath(path.join(bloomDir, "Objects"), `${params.slug}.md`);
		} catch {
			return errorResult("Path traversal blocked: invalid slug");
		}
	}

	if (!fs.existsSync(filepath)) {
		return errorResult(`object not found: ${params.type}/${params.slug}`);
	}
	const raw = fs.readFileSync(filepath, "utf-8");
	return {
		content: [{ type: "text" as const, text: truncate(raw) }],
		details: {},
	};
}

/** Add bidirectional links between two objects. */
export function linkObjects(params: { ref_a: string; ref_b: string }) {
	const bloomDir = getBloomDir();
	const a = parseRef(params.ref_a);
	const b = parseRef(params.ref_b);
	let pathA: string;
	let pathB: string;
	try {
		pathA = safePath(path.join(bloomDir, "Objects"), `${a.slug}.md`);
		pathB = safePath(path.join(bloomDir, "Objects"), `${b.slug}.md`);
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

	return {
		content: [
			{
				type: "text" as const,
				text: `linked ${params.ref_a} <-> ${params.ref_b}`,
			},
		],
		details: {},
	};
}
