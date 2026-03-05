import fs from "node:fs";
import path from "node:path";
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
	errorResult,
	getGardenDir,
	nowIso,
	PARA_DIRS,
	parseFrontmatter,
	stringifyFrontmatter,
	truncate,
} from "./shared.js";

function parseRef(ref: string): { type: string; slug: string } {
	const slash = ref.indexOf("/");
	if (slash === -1) throw new Error(`invalid reference format: '${ref}' (expected type/slug)`);
	return { type: ref.slice(0, slash), slug: ref.slice(slash + 1) };
}

// --- In-memory index ---

interface IndexEntry {
	ref: string;
	path: string;
	title?: string;
	project?: string;
	area?: string;
	type: string;
	slug: string;
}

const index: Map<string, IndexEntry> = new Map();

function buildIndex(gardenDir: string): void {
	index.clear();
	for (const paraDir of PARA_DIRS) {
		const dir = path.join(gardenDir, paraDir);
		if (!fs.existsSync(dir)) continue;
		const files = fs.globSync("**/*.md", { cwd: dir });
		for (const file of files) {
			if (file.endsWith(".pi.md")) continue;
			indexFile(path.join(dir, file));
		}
	}
}

function indexFile(filepath: string): void {
	try {
		const raw = fs.readFileSync(filepath, "utf-8");
		const { attributes } = parseFrontmatter<Record<string, unknown>>(raw);
		if (!attributes.type) return;
		const type = String(attributes.type);
		const slug = String(attributes.slug ?? path.basename(filepath, ".md"));
		const ref = `${type}/${slug}`;
		index.set(ref, {
			ref,
			path: filepath,
			title: attributes.title as string | undefined,
			project: attributes.project as string | undefined,
			area: attributes.area as string | undefined,
			type,
			slug,
		});
	} catch {
		// Skip unreadable files
	}
}

function resolveCreatePath(gardenDir: string, slug: string, fields: Record<string, string>): string {
	if (fields.project) return path.join(gardenDir, "Projects", fields.project, `${slug}.md`);
	if (fields.area) return path.join(gardenDir, "Areas", fields.area, `${slug}.md`);
	return path.join(gardenDir, "Inbox", `${slug}.md`);
}

function findFileByName(dir: string, filename: string, type: string): string | null {
	if (!fs.existsSync(dir)) return null;
	const matches = fs.globSync(`**/${filename}`, { cwd: dir });
	for (const match of matches) {
		const filepath = path.join(dir, match);
		const raw = fs.readFileSync(filepath, "utf-8");
		const { attributes } = parseFrontmatter<Record<string, unknown>>(raw);
		if (String(attributes.type ?? "") === type) return filepath;
	}
	return null;
}

function findObject(gardenDir: string, type: string, slug: string): string | null {
	const ref = `${type}/${slug}`;
	const entry = index.get(ref);
	if (entry && fs.existsSync(entry.path)) return entry.path;

	const filename = `${slug}.md`;
	for (const paraDir of PARA_DIRS) {
		const found = findFileByName(path.join(gardenDir, paraDir), filename, type);
		if (found) {
			indexFile(found);
			return found;
		}
	}
	return null;
}

function walkMdFiles(dir: string): string[] {
	if (!fs.existsSync(dir)) return [];
	return fs.globSync("**/*.md", { cwd: dir }).map((f) => path.join(dir, f));
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", () => {
		buildIndex(getGardenDir());
	});

	pi.registerTool({
		name: "memory_create",
		label: "Memory Create",
		description: "Create a new markdown object in the Garden vault",
		promptSnippet: "Create a new tracked object (task, note, project, etc.)",
		promptGuidelines: [
			"Use memory_create when the user mentions something new to track. Always set a title. Suggest PARA fields (project, area) when relevant.",
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
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const gardenDir = getGardenDir();
			const fields = params.fields ?? {};
			const filepath = resolveCreatePath(gardenDir, params.slug, fields);
			fs.mkdirSync(path.dirname(filepath), { recursive: true });

			const now = nowIso();
			const priorityKeys = ["type", "slug", "title", "status", "priority", "project", "area"];
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

			index.set(`${params.type}/${params.slug}`, {
				ref: `${params.type}/${params.slug}`,
				path: filepath,
				title,
				project: fields.project,
				area: fields.area,
				type: params.type,
				slug: params.slug,
			});

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
		description: "Read a markdown object from the Garden vault",
		promptSnippet: "Read a specific object by type and slug",
		promptGuidelines: ["Use memory_read to retrieve a specific object by type and slug."],
		parameters: Type.Object({
			type: Type.String({ description: "Object type" }),
			slug: Type.String({ description: "Object slug" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const gardenDir = getGardenDir();
			const filepath = findObject(gardenDir, params.type, params.slug);
			if (!filepath) {
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
		description: "Search all objects for a pattern (simple string match)",
		promptSnippet: "Search objects by content pattern",
		promptGuidelines: ["Use memory_search when the user remembers content but not the exact object name."],
		parameters: Type.Object({
			pattern: Type.String({
				description: "Text pattern to search for",
			}),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			const gardenDir = getGardenDir();
			const matches: string[] = [];

			for (const paraDir of PARA_DIRS) {
				if (signal?.aborted) break;
				for (const filepath of walkMdFiles(path.join(gardenDir, paraDir))) {
					try {
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
			const gardenDir = getGardenDir();
			const a = parseRef(params.ref_a);
			const b = parseRef(params.ref_b);
			const pathA = findObject(gardenDir, a.type, a.slug);
			const pathB = findObject(gardenDir, b.type, b.slug);

			if (!pathA) return errorResult(`object not found: ${params.ref_a}`);
			if (!pathB) return errorResult(`object not found: ${params.ref_b}`);

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
		description: "List objects, optionally filtered by type, frontmatter fields, or PARA category",
		promptSnippet: "List objects by type, filter, or PARA category",
		promptGuidelines: ["Use memory_list to show all objects of a type, or filter by status, area, para category, etc."],
		parameters: Type.Object({
			type: Type.Optional(Type.String({ description: "Object type to filter by" })),
			para: Type.Optional(StringEnum(["Inbox", "Projects", "Areas", "Resources", "Archive"] as const)),
			filters: Type.Optional(
				Type.Record(Type.String(), Type.String(), {
					description: "Frontmatter field filters",
				}),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			const gardenDir = getGardenDir();
			const filters = params.filters ?? {};
			const results: string[] = [];

			const dirsToSearch = params.para
				? [path.join(gardenDir, params.para)]
				: PARA_DIRS.map((d) => path.join(gardenDir, d));

			for (const dir of dirsToSearch) {
				if (signal?.aborted) break;
				for (const filepath of walkMdFiles(dir)) {
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
			}

			const text = results.length > 0 ? results.join("\n") : "No objects found";
			return {
				content: [{ type: "text" as const, text: truncate(text) }],
				details: {},
			};
		},
	});

	pi.registerTool({
		name: "memory_move",
		label: "Memory Move",
		description: "Relocate an object between PARA categories",
		promptSnippet: "Move an object between PARA categories",
		promptGuidelines: ["Use memory_move to relocate an object to a different project, area, or archive."],
		parameters: Type.Object({
			type: Type.String({ description: "Object type" }),
			slug: Type.String({ description: "Object slug" }),
			project: Type.Optional(Type.String({ description: "Target project name" })),
			area: Type.Optional(Type.String({ description: "Target area name" })),
			archive: Type.Optional(Type.Boolean({ description: "Move to Archive" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const gardenDir = getGardenDir();
			const oldPath = findObject(gardenDir, params.type, params.slug);
			if (!oldPath) return errorResult(`object not found: ${params.type}/${params.slug}`);

			const raw = fs.readFileSync(oldPath, "utf-8");
			const { attributes, body } = parseFrontmatter<Record<string, unknown>>(raw);

			if (params.archive) {
				delete attributes.project;
				delete attributes.area;
			} else if (params.project) {
				attributes.project = params.project;
				delete attributes.area;
			} else if (params.area) {
				attributes.area = params.area;
				delete attributes.project;
			} else {
				delete attributes.project;
				delete attributes.area;
			}
			attributes.modified = nowIso();

			let newPath: string;
			if (params.archive) {
				newPath = path.join(gardenDir, "Archive", `${params.slug}.md`);
			} else if (params.project) {
				newPath = path.join(gardenDir, "Projects", params.project, `${params.slug}.md`);
			} else if (params.area) {
				newPath = path.join(gardenDir, "Areas", params.area, `${params.slug}.md`);
			} else {
				newPath = path.join(gardenDir, "Inbox", `${params.slug}.md`);
			}

			fs.mkdirSync(path.dirname(newPath), { recursive: true });
			fs.writeFileSync(newPath, stringifyFrontmatter(attributes, body));
			fs.unlinkSync(oldPath);

			const ref = `${params.type}/${params.slug}`;
			index.set(ref, {
				ref,
				path: newPath,
				title: attributes.title as string | undefined,
				project: params.project,
				area: params.area,
				type: params.type,
				slug: params.slug,
			});

			return {
				content: [
					{
						type: "text" as const,
						text: `moved ${ref} → ${newPath}`,
					},
				],
				details: {},
			};
		},
	});

	pi.registerTool({
		name: "garden_reindex",
		label: "Garden Reindex",
		description: "Rebuild the in-memory object index",
		promptSnippet: "Force rebuild the Garden index",
		promptGuidelines: ["Use garden_reindex after external file changes to update the index."],
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, signal, _onUpdate, _ctx) {
			if (signal?.aborted) return errorResult("aborted");
			buildIndex(getGardenDir());
			return {
				content: [
					{
						type: "text" as const,
						text: `indexed ${index.size} objects`,
					},
				],
				details: {},
			};
		},
	});
}
