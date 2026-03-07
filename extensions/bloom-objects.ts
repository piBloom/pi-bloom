/**
 * bloom-objects — Flat-file object store with YAML frontmatter in ~/Bloom/Objects/.
 *
 * @tools memory_create, memory_read, memory_search, memory_link, memory_list
 * @see {@link ../AGENTS.md#bloom-objects} Extension reference
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { parseRef } from "../lib/object-utils.js";
import {
	errorResult,
	getBloomDir,
	nowIso,
	parseFrontmatter,
	safePath,
	stringifyFrontmatter,
	truncate,
} from "../lib/shared.js";

export default function (pi: ExtensionAPI) {
	/** Walk a directory recursively for .md files. */
	function walkMdFiles(dir: string): string[] {
		if (!fs.existsSync(dir)) return [];
		return fs.globSync("**/*.md", { cwd: dir }).map((f) => path.join(dir, f));
	}

	pi.registerTool({
		name: "memory_create",
		label: "Memory Create",
		description: "Create a new markdown object in ~/Bloom/Objects/",
		promptSnippet: "Create a new tracked object (task, note, project, etc.)",
		promptGuidelines: [
			"Use memory_create when the user mentions something new to track. Always set a title.",
		],
		parameters: Type.Object({
			type: Type.String({
				description: "Object type (e.g. task, note, project)",
			}),
			slug: Type.String({
				description: "URL-friendly identifier (e.g. fix-bike-tire)",
			}),
			fields: Type.Optional(
				Type.Record(Type.String(), Type.String(), {
					description: "Additional frontmatter fields",
				}),
			),
			path: Type.Optional(
				Type.String({
					description: "Optional file path relative to home dir (default: Bloom/Objects/{slug}.md)",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const bloomDir = getBloomDir();
			let filepath: string;
			try {
				filepath = params.path
					? safePath(os.homedir(), params.path)
					: safePath(bloomDir, "Objects", `${params.slug}.md`);
			} catch {
				return errorResult("Path traversal blocked: invalid path");
			}
			fs.mkdirSync(path.dirname(filepath), { recursive: true });

			const fields = params.fields ?? {};
			const now = nowIso();
			const priorityKeys = ["type", "slug", "title", "status", "priority"];
			const data: Record<string, unknown> = {
				type: params.type,
				slug: params.slug,
			};

			for (const k of priorityKeys.slice(2)) {
				if (k in fields) data[k] = fields[k];
			}
			for (const k of Object.keys(fields)
				.filter((k) => !priorityKeys.includes(k))
				.sort()) {
				const val = fields[k];
				if (k === "tags" || k === "links") {
					data[k] = val
						.split(",")
						.map((s) => s.trim())
						.filter(Boolean);
				} else {
					data[k] = val;
				}
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
		},
	});

	pi.registerTool({
		name: "memory_read",
		label: "Memory Read",
		description: "Read a markdown object from ~/Bloom/Objects/",
		promptSnippet: "Read a specific object by type and slug",
		promptGuidelines: ["Use memory_read to retrieve a specific object by type and slug."],
		parameters: Type.Object({
			type: Type.String({ description: "Object type" }),
			slug: Type.String({ description: "Object slug" }),
			path: Type.Optional(
				Type.String({ description: "Optional direct file path relative to home dir" }),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			let filepath: string;
			if (params.path) {
				try {
					filepath = safePath(os.homedir(), params.path);
				} catch {
					return errorResult("Path traversal blocked: invalid path");
				}
			} else {
				const bloomDir = getBloomDir();
				filepath = path.join(bloomDir, "Objects", `${params.slug}.md`);
			}

			if (!fs.existsSync(filepath)) {
				return errorResult(`object not found: ${params.type}/${params.slug}`);
			}
			const raw = fs.readFileSync(filepath, "utf-8");
			return {
				content: [{ type: "text" as const, text: truncate(raw) }],
				details: {},
			};
		},
	});

	pi.registerTool({
		name: "memory_search",
		label: "Memory Search",
		description: "Search markdown files for a pattern (simple string match)",
		promptSnippet: "Search objects by content pattern",
		promptGuidelines: ["Use memory_search when the user remembers content but not the exact object name."],
		parameters: Type.Object({
			pattern: Type.String({
				description: "Text pattern to search for",
			}),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			const homeDir = os.homedir();
			const excludes = ["node_modules", ".git", ".cache", ".local", ".pi"];
			const matches: string[] = [];

			const files = fs.globSync("**/*.md", { cwd: homeDir });
			for (const file of files) {
				if (signal?.aborted) break;
				if (excludes.some((ex) => file.includes(ex))) continue;
				try {
					const filepath = path.join(homeDir, file);
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
		},
	});

	pi.registerTool({
		name: "memory_link",
		label: "Memory Link",
		description: "Add bidirectional links between two objects",
		promptSnippet: "Link two objects bidirectionally",
		promptGuidelines: ["Use memory_link when two objects are related. Links are bidirectional."],
		parameters: Type.Object({
			ref_a: Type.String({
				description: "First object reference (type/slug)",
			}),
			ref_b: Type.String({
				description: "Second object reference (type/slug)",
			}),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const bloomDir = getBloomDir();
			const a = parseRef(params.ref_a);
			const b = parseRef(params.ref_b);
			const pathA = path.join(bloomDir, "Objects", `${a.slug}.md`);
			const pathB = path.join(bloomDir, "Objects", `${b.slug}.md`);

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
		},
	});

	pi.registerTool({
		name: "memory_list",
		label: "Memory List",
		description: "List objects, optionally filtered by type or frontmatter fields",
		promptSnippet: "List objects by type or filter",
		promptGuidelines: ["Use memory_list to show all objects of a type, or filter by status, etc."],
		parameters: Type.Object({
			type: Type.Optional(Type.String({ description: "Object type to filter by" })),
			directory: Type.Optional(
				Type.String({ description: "Directory to walk (default: ~/Bloom/Objects/)" }),
			),
			filters: Type.Optional(
				Type.Record(Type.String(), Type.String(), {
					description: "Frontmatter field filters",
				}),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
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
		},
	});
}
