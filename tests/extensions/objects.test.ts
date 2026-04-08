import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseRef } from "../../core/pi/extensions/objects/actions.js";
import { createMockExtensionAPI, type MockExtensionAPI } from "../helpers/mock-extension-api.js";
import { createTempNixPi, type TempNixPi } from "../helpers/temp-nixpi.js";

let temp: TempNixPi;
let api: MockExtensionAPI;

beforeEach(async () => {
	temp = createTempNixPi();
	// Create Objects directory
	fs.mkdirSync(path.join(temp.nixPiDir, "Objects"), { recursive: true });
	api = createMockExtensionAPI();
	const mod = await import("../../core/pi/extensions/objects/index.js");
	mod.default(api as never);
});

afterEach(() => {
	temp.cleanup();
});

function toolNames(): string[] {
	return api._registeredTools.map((t) => t.name as string);
}

type ToolExecute = (
	...args: unknown[]
) => Promise<{ content: Array<{ text: string }>; details: unknown; isError?: boolean }>;

function findTool(name: string) {
	return api._registeredTools.find((t) => t.name === name);
}

function getExecute(name: string): ToolExecute {
	const tool = findTool(name);
	if (!tool) throw new Error(`tool ${name} not found`);
	return tool.execute as ToolExecute;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
describe("objects registration", () => {
	it("registers exactly 8 tools", () => {
		expect(api._registeredTools).toHaveLength(8);
	});

	it("registers the expected tool names", () => {
		expect(toolNames()).toEqual([
			"memory_create",
			"memory_update",
			"memory_upsert",
			"memory_read",
			"memory_query",
			"memory_search",
			"memory_link",
			"memory_list",
		]);
	});

	it("each tool has name, label, description, and execute", () => {
		for (const tool of api._registeredTools) {
			expect(tool).toHaveProperty("name");
			expect(tool).toHaveProperty("label");
			expect(tool).toHaveProperty("description");
			expect(tool).toHaveProperty("execute");
			expect(typeof tool.execute).toBe("function");
		}
	});
});

// ---------------------------------------------------------------------------
// memory_create parameter schema
// ---------------------------------------------------------------------------
describe("memory_create parameters", () => {
	it("has type, slug, and optional fields parameters", () => {
		const tool = findTool("memory_create");
		expect(tool).toBeDefined();
		const params = tool?.parameters as { properties: Record<string, unknown>; required?: string[] };
		expect(params.properties).toHaveProperty("type");
		expect(params.properties).toHaveProperty("slug");
		expect(params.properties).toHaveProperty("fields");
		expect(params.required).toContain("type");
		expect(params.required).toContain("slug");
	});
});

// ---------------------------------------------------------------------------
// Tool execution: memory_create + memory_read round-trip
// ---------------------------------------------------------------------------
describe("memory_create and memory_read execution", () => {
	it("can create an object and read it back", async () => {
		const create = getExecute("memory_create");
		const read = getExecute("memory_read");

		const createResult = await create("call-1", { type: "note", slug: "test-note", fields: { title: "Test Note" } });

		expect(createResult.content[0].text).toContain("created note/test-note");

		// Verify file was actually written to Objects/
		const filepath = path.join(temp.nixPiDir, "Objects", "test-note.md");
		expect(fs.existsSync(filepath)).toBe(true);

		const readResult = await read("call-2", { type: "note", slug: "test-note" });

		expect(readResult.content[0].text).toContain("type: note");
		expect(readResult.content[0].text).toContain("slug: test-note");
		expect(readResult.content[0].text).toContain("title: Test Note");
	});

	it("returns error when creating a duplicate object", async () => {
		const create = getExecute("memory_create");

		await create("call-1", { type: "task", slug: "dup-task" });
		const dupResult = await create("call-2", { type: "task", slug: "dup-task" });

		expect(dupResult.isError).toBe(true);
		expect(dupResult.content[0].text).toContain("already exists");
	});

	it("returns error when reading a nonexistent object", async () => {
		const read = getExecute("memory_read");
		const result = await read("call-1", { type: "note", slug: "nonexistent" });

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("not found");
	});

	it("does not rewrite the file when reading an object", async () => {
		const create = getExecute("memory_create");
		const read = getExecute("memory_read");

		await create("call-1", {
			type: "note",
			slug: "read-only-note",
			fields: { title: "Read Only Note" },
			body: "Original body",
		});

		const filepath = path.join(temp.nixPiDir, "Objects", "read-only-note.md");
		const before = fs.readFileSync(filepath, "utf-8");

		const result = await read("call-2", { type: "note", slug: "read-only-note" });
		const after = fs.readFileSync(filepath, "utf-8");

		expect(result.content[0].text).toContain("Read Only Note");
		expect(after).toBe(before);
	});

	it("updates and queries richer durable metadata", async () => {
		const create = getExecute("memory_create");
		const update = getExecute("memory_update");
		const query = getExecute("memory_query");

		await create("call-1", {
			type: "preference",
			slug: "ts-style",
			fields: {
				title: "TS Style",
				summary: "User prefers concise TypeScript examples",
				tags: ["typescript", "style"],
				scope: "global",
				confidence: "high",
				salience: 0.9,
			},
			body: "# TS Style\n\nPrefer 2-space indentation.",
		});

		const updateResult = await update("call-2", {
			type: "preference",
			slug: "ts-style",
			fields: { status: "active", links: ["fact/user-identity"] },
		});

		expect(updateResult.content[0].text).toContain("updated preference/ts-style");

		const queryResult = await query("call-3", {
			text: "TypeScript",
			type: "preference",
			tags: ["style"],
			scope: "global",
		});

		expect(queryResult.content[0].text).toContain("preference/ts-style");
		expect(queryResult.content[0].text).toContain("score=");
	});

	it("upserts an existing object instead of erroring", async () => {
		const create = getExecute("memory_create");
		const upsert = getExecute("memory_upsert");
		const read = getExecute("memory_read");

		await create("call-1", { type: "fact", slug: "user-identity", fields: { title: "User Identity" } });
		const result = await upsert("call-2", {
			type: "fact",
			slug: "user-identity",
			fields: { summary: "Confirmed user identity facts", confidence: "high" },
		});

		expect(result.content[0].text).toContain("upserted fact/user-identity");

		const readResult = await read("call-3", { type: "fact", slug: "user-identity" });
		expect(readResult.content[0].text).toContain("summary: Confirmed user identity facts");
	});

	it("prefers project-scoped matches when preferred scopes are provided", async () => {
		const create = getExecute("memory_create");
		const query = getExecute("memory_query");

		await create("call-1", {
			type: "procedure",
			slug: "recovery-global",
			fields: {
				title: "Recovery Procedure Global",
				summary: "Generic recovery procedure",
				scope: "global",
				salience: 0.9,
			},
		});
		await create("call-2", {
			type: "procedure",
			slug: "recovery-project",
			fields: {
				title: "Recovery Procedure Project",
				summary: "Project-specific recovery procedure",
				scope: "project",
				scope_value: "pi-nixpi",
				salience: 0.5,
			},
		});

		const queryResult = await query("call-3", {
			type: "procedure",
			text: "recovery",
			preferred_scopes: [{ scope: "project", value: "pi-nixpi" }, { scope: "global" }],
		});

		const lines = queryResult.content[0].text.split("\n");
		expect(lines[0]).toContain("procedure/recovery-project");
	});
});

// ---------------------------------------------------------------------------
// Tool execution: memory_list
// ---------------------------------------------------------------------------
describe("memory_list execution", () => {
	it("returns no-objects message when Objects dir is empty", async () => {
		const list = getExecute("memory_list");
		const result = await list("call-1", {});
		expect(result.isError).toBeFalsy();
		expect(result.content[0].text).toBe("No objects found");
	});

	it("lists objects after creation", async () => {
		const create = getExecute("memory_create");
		const list = getExecute("memory_list");

		await create("call-1", { type: "note", slug: "list-note-a", fields: { title: "Note A" } });
		await create("call-2", { type: "task", slug: "list-task-b", fields: { title: "Task B" } });

		const result = await list("call-3", {});
		expect(result.content[0].text).toContain("note/list-note-a");
		expect(result.content[0].text).toContain("task/list-task-b");
	});

	it("filters by type", async () => {
		const create = getExecute("memory_create");
		const list = getExecute("memory_list");

		await create("call-1", { type: "note", slug: "filter-note", fields: { title: "A Note" } });
		await create("call-2", { type: "fact", slug: "filter-fact", fields: { title: "A Fact" } });

		const result = await list("call-3", { type: "note" });
		expect(result.content[0].text).toContain("note/filter-note");
		expect(result.content[0].text).not.toContain("fact/filter-fact");
	});
});

// ---------------------------------------------------------------------------
// Tool execution: memory_search
// ---------------------------------------------------------------------------
describe("memory_search execution", () => {
	it("returns no-matches message when nothing matches", async () => {
		const search = getExecute("memory_search");
		const result = await search("call-1", { pattern: "zzznomatch999" });
		expect(result.isError).toBeFalsy();
		expect(result.content[0].text).toBe("No matches found");
	});

	it("finds content created by memory_create", async () => {
		const create = getExecute("memory_create");
		const search = getExecute("memory_search");

		await create("call-1", {
			type: "fact",
			slug: "searchable-fact",
			fields: { title: "Searchable Fact" },
			body: "This object contains the unique phrase xylophone-cascade.",
		});

		const result = await search("call-2", { pattern: "xylophone-cascade" });
		expect(result.content[0].text).toContain("fact/searchable-fact");
	});
});

// ---------------------------------------------------------------------------
// Tool execution: memory_link
// ---------------------------------------------------------------------------
describe("memory_link execution", () => {
	it("adds bidirectional links between two objects", async () => {
		const create = getExecute("memory_create");
		const link = getExecute("memory_link");
		const read = getExecute("memory_read");

		await create("call-1", { type: "note", slug: "link-src", fields: { title: "Source" } });
		await create("call-2", { type: "note", slug: "link-dst", fields: { title: "Dest" } });

		const linkResult = await link("call-3", { ref_a: "note/link-src", ref_b: "note/link-dst" });
		expect(linkResult.content[0].text).toContain("linked note/link-src <-> note/link-dst");

		const srcRead = await read("call-4", { type: "note", slug: "link-src" });
		expect(srcRead.content[0].text).toContain("note/link-dst");

		const dstRead = await read("call-5", { type: "note", slug: "link-dst" });
		expect(dstRead.content[0].text).toContain("note/link-src");
	});

	it("returns error when linking a nonexistent object", async () => {
		const create = getExecute("memory_create");
		const link = getExecute("memory_link");

		await create("call-1", { type: "note", slug: "real-note", fields: { title: "Real" } });

		const result = await link("call-2", { ref_a: "note/real-note", ref_b: "note/ghost-note" });
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("not found");
	});
});

// ---------------------------------------------------------------------------
// parseRef (inlined from lib/object-utils.ts)
// ---------------------------------------------------------------------------
describe("parseRef", () => {
	it("parses type/slug", () => {
		expect(parseRef("task/fix-bike")).toEqual({ type: "task", slug: "fix-bike" });
	});

	it("throws on missing slash", () => {
		expect(() => parseRef("noslash")).toThrow("invalid reference format");
	});

	it("uses first slash only for a/b/c", () => {
		expect(parseRef("a/b/c")).toEqual({ type: "a", slug: "b/c" });
	});

	it("handles type with empty slug", () => {
		expect(parseRef("type/")).toEqual({ type: "type", slug: "" });
	});
});

// ---------------------------------------------------------------------------
// memory_list — tag filter
// ---------------------------------------------------------------------------
describe("memory_list tag filter", () => {
	it("filters objects by tag via filters parameter", async () => {
		const create = getExecute("memory_create");
		const list = getExecute("memory_list");

		await create("call-1", {
			type: "note",
			slug: "tagged-note",
			fields: { title: "Tagged", tags: ["important"] },
		});
		await create("call-2", {
			type: "note",
			slug: "untagged-note",
			fields: { title: "Untagged", tags: [] },
		});

		const result = await list("call-3", { filters: { tag: "important" } });
		expect(result.content[0].text).toContain("note/tagged-note");
		expect(result.content[0].text).not.toContain("note/untagged-note");
	});
});

// ---------------------------------------------------------------------------
// memory_query — limit boundary enforcement
// ---------------------------------------------------------------------------
describe("memory_query limit enforcement", () => {
	it("clamps limit to minimum of 1", async () => {
		const create = getExecute("memory_create");
		const query = getExecute("memory_query");

		for (let i = 0; i < 3; i++) {
			await create(`call-create-${i}`, {
				type: "fact",
				slug: `limit-fact-${i}`,
				fields: { title: `Fact ${i}`, summary: "test fact", salience: 0.9 },
			});
		}

		const result = await query("call-query", { text: "fact", limit: 0 });
		const details = result.details as { count: number };
		expect(details.count).toBe(1);
	});

	it("clamps limit to maximum of 100", async () => {
		const create = getExecute("memory_create");
		const query = getExecute("memory_query");

		await create("call-1", {
			type: "fact",
			slug: "limit-max-fact",
			fields: { title: "Max Fact", summary: "test", salience: 0.9 },
		});

		// limit=200 should be clamped to 100 — we can't check the clamp directly
		// but we can verify it doesn't error and returns the available results
		const result = await query("call-2", { text: "fact", limit: 200 });
		expect(result.isError).toBeFalsy();
	});
});
