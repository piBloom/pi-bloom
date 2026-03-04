import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StringEnum } from "@mariozechner/pi-ai";
import { type ExtensionAPI, truncateHead } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

function nowIso(): string {
	return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function parseFrontmatter(raw: string): {
	data: Record<string, unknown>;
	content: string;
} {
	if (!raw.startsWith("---\n")) return { data: {}, content: raw };
	const end = raw.indexOf("\n---\n", 4);
	if (end === -1) return { data: {}, content: raw };
	const yaml = raw.slice(4, end);
	const content = raw.slice(end + 5);
	const data: Record<string, unknown> = {};
	let currentKey: string | null = null;
	let currentArray: string[] | null = null;
	for (const line of yaml.split("\n")) {
		if (line.startsWith("  - ") && currentKey && currentArray) {
			currentArray.push(line.slice(4).trim());
			continue;
		}
		if (currentKey && currentArray) {
			data[currentKey] = currentArray;
			currentKey = null;
			currentArray = null;
		}
		const colon = line.indexOf(":");
		if (colon === -1) continue;
		const key = line.slice(0, colon).trim();
		const val = line.slice(colon + 1).trim();
		if (val === "") {
			currentKey = key;
			currentArray = [];
		} else if (val.includes(",")) {
			data[key] = val
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean);
		} else {
			data[key] = val;
		}
	}
	if (currentKey && currentArray) data[currentKey] = currentArray;
	return { data, content };
}

function stringifyFrontmatter(data: Record<string, unknown>, content: string): string {
	const lines: string[] = ["---"];
	for (const [key, val] of Object.entries(data)) {
		if (Array.isArray(val)) {
			lines.push(`${key}: ${val.join(", ")}`);
		} else {
			lines.push(`${key}: ${val}`);
		}
	}
	lines.push("---");
	return `${lines.join("\n")}\n${content}`;
}

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

const PARA_DIRS = ["Inbox", "Projects", "Areas", "Resources", "Archive"];

function getGardenDir(): string {
	return process.env._BLOOM_GARDEN_RESOLVED ?? process.env.BLOOM_GARDEN_DIR ?? path.join(os.homedir(), "Garden");
}

function buildIndex(gardenDir: string): void {
	index.clear();
	for (const paraDir of PARA_DIRS) {
		scanDir(path.join(gardenDir, paraDir));
	}
}

function scanDir(dir: string): void {
	if (!fs.existsSync(dir)) return;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			scanDir(path.join(dir, entry.name));
		} else if (entry.name.endsWith(".md") && !entry.name.endsWith(".pi.md")) {
			indexFile(path.join(dir, entry.name));
		}
	}
}

function indexFile(filepath: string): void {
	try {
		const raw = fs.readFileSync(filepath, "utf-8");
		const { data } = parseFrontmatter(raw);
		if (!data.type) return;
		const type = String(data.type);
		const slug = String(data.slug ?? path.basename(filepath, ".md"));
		const ref = `${type}/${slug}`;
		index.set(ref, {
			ref,
			path: filepath,
			title: data.title as string | undefined,
			project: data.project as string | undefined,
			area: data.area as string | undefined,
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

function findObject(gardenDir: string, type: string, slug: string): string | null {
	const ref = `${type}/${slug}`;
	const entry = index.get(ref);
	if (entry && fs.existsSync(entry.path)) return entry.path;

	const filename = `${slug}.md`;
	for (const paraDir of PARA_DIRS) {
		const found = scanForFile(path.join(gardenDir, paraDir), filename, type);
		if (found) {
			indexFile(found);
			return found;
		}
	}
	return null;
}

function scanForFile(dir: string, filename: string, type: string): string | null {
	if (!fs.existsSync(dir)) return null;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			const found = scanForFile(path.join(dir, entry.name), filename, type);
			if (found) return found;
		} else if (entry.name === filename) {
			const filepath = path.join(dir, entry.name);
			const raw = fs.readFileSync(filepath, "utf-8");
			const { data } = parseFrontmatter(raw);
			if (String(data.type ?? "") === type) return filepath;
		}
	}
	return null;
}

function walkFiles(dir: string, callback: (filepath: string, raw: string) => void): void {
	if (!fs.existsSync(dir)) return;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			walkFiles(path.join(dir, entry.name), callback);
		} else if (entry.name.endsWith(".md")) {
			const filepath = path.join(dir, entry.name);
			try {
				callback(filepath, fs.readFileSync(filepath, "utf-8"));
			} catch {
				// Skip unreadable files
			}
		}
	}
}

function truncate(text: string): string {
	return truncateHead(text, { maxLines: 2000, maxBytes: 50000 }).content;
}

function errorResult(message: string) {
	return {
		content: [{ type: "text" as const, text: message }],
		details: {},
		isError: true,
	};
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
				walkFiles(path.join(gardenDir, paraDir), (filepath, raw) => {
					if (!raw.includes(params.pattern)) return;
					const { data } = parseFrontmatter(raw);
					const type = String(data.type ?? "note");
					const slug = String(data.slug ?? path.basename(filepath, ".md"));
					const ref = `${type}/${slug}`;
					const title = data.title ? ` \u2014 ${data.title}` : "";
					matches.push(`${ref}${title}`);
				});
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
				const { data, content } = parseFrontmatter(raw);
				const links: string[] = Array.isArray(data.links) ? [...(data.links as string[])] : [];
				if (!links.includes(linkRef)) {
					links.push(linkRef);
					data.links = links;
					fs.writeFileSync(fp, stringifyFrontmatter(data, content));
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
				walkFiles(dir, (_filepath, raw) => {
					const { data } = parseFrontmatter(raw);
					const type = String(data.type ?? "note");
					if (params.type && type !== params.type) return;

					let match = true;
					for (const [key, val] of Object.entries(filters)) {
						if (key === "tag") {
							const tags = Array.isArray(data.tags) ? data.tags : [];
							if (!(tags as string[]).includes(val)) {
								match = false;
								break;
							}
						} else {
							if (String(data[key] ?? "") !== val) {
								match = false;
								break;
							}
						}
					}
					if (!match) return;

					const slug = String(data.slug ?? "unknown");
					const title = data.title ? ` \u2014 ${data.title}` : "";
					results.push(`${type}/${slug}${title}`);
				});
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
			const { data, content } = parseFrontmatter(raw);

			if (params.archive) {
				delete data.project;
				delete data.area;
			} else if (params.project) {
				data.project = params.project;
				delete data.area;
			} else if (params.area) {
				data.area = params.area;
				delete data.project;
			} else {
				delete data.project;
				delete data.area;
			}
			data.modified = nowIso();

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
			fs.writeFileSync(newPath, stringifyFrontmatter(data, content));
			fs.unlinkSync(oldPath);

			const ref = `${params.type}/${params.slug}`;
			index.set(ref, {
				ref,
				path: newPath,
				title: data.title as string | undefined,
				project: params.project,
				area: params.area,
				type: params.type,
				slug: params.slug,
			});

			return {
				content: [
					{
						type: "text" as const,
						text: `moved ${ref} \u2192 ${newPath}`,
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

	pi.registerTool({
		name: "journal_write",
		label: "Journal Write",
		description: "Write an entry to the daily journal",
		promptSnippet: "Write a journal entry for today or a specific date",
		promptGuidelines: ["Use journal_write for daily reflections, logs, or observations. AI entries use origin 'pi'."],
		parameters: Type.Object({
			content: Type.String({ description: "Journal entry content" }),
			date: Type.Optional(
				Type.String({
					description: "Date in YYYY-MM-DD format (default: today)",
				}),
			),
			origin: Type.Optional(StringEnum(["pi", "user"] as const)),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const gardenDir = getGardenDir();
			const date = params.date ?? new Date().toISOString().slice(0, 10);
			const origin = params.origin ?? "pi";
			const [year, month] = date.split("-");
			const suffix = origin === "pi" ? ".pi.md" : ".md";
			const filepath = path.join(gardenDir, "Journal", year, month, `${date}${suffix}`);
			fs.mkdirSync(path.dirname(filepath), { recursive: true });

			if (fs.existsSync(filepath)) {
				const existing = fs.readFileSync(filepath, "utf-8");
				const timestamp = nowIso();
				fs.writeFileSync(filepath, `${existing}\n\n---\n\n*${timestamp}*\n\n${params.content}`);
			} else {
				const data: Record<string, unknown> = {
					date,
					origin,
					created: nowIso(),
				};
				fs.writeFileSync(filepath, stringifyFrontmatter(data, `\n${params.content}\n`));
			}

			return {
				content: [
					{
						type: "text" as const,
						text: `journal entry written for ${date}`,
					},
				],
				details: {},
			};
		},
	});

	pi.registerTool({
		name: "journal_read",
		label: "Journal Read",
		description: "Read journal entries for a date",
		promptSnippet: "Read journal entries for today or a specific date",
		promptGuidelines: ["Use journal_read to review daily journal entries."],
		parameters: Type.Object({
			date: Type.Optional(
				Type.String({
					description: "Date in YYYY-MM-DD format (default: today)",
				}),
			),
			include_ai: Type.Optional(
				Type.Boolean({
					description: "Include AI journal entries (default: true)",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const gardenDir = getGardenDir();
			const date = params.date ?? new Date().toISOString().slice(0, 10);
			const includeAi = params.include_ai !== false;
			const [year, month] = date.split("-");
			const journalDir = path.join(gardenDir, "Journal", year, month);
			const parts: string[] = [];

			const userFile = path.join(journalDir, `${date}.md`);
			if (fs.existsSync(userFile)) {
				parts.push(`## User Journal\n\n${fs.readFileSync(userFile, "utf-8")}`);
			}

			if (includeAi) {
				const aiFile = path.join(journalDir, `${date}.pi.md`);
				if (fs.existsSync(aiFile)) {
					parts.push(`## AI Journal\n\n${fs.readFileSync(aiFile, "utf-8")}`);
				}
			}

			const text = parts.length > 0 ? parts.join("\n\n---\n\n") : `No journal entries for ${date}`;
			return {
				content: [{ type: "text" as const, text: truncate(text) }],
				details: {},
			};
		},
	});
}
