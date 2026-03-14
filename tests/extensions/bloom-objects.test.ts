import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseRef } from "../../core/extensions/bloom-objects/actions.js";
import { createMockExtensionAPI, type MockExtensionAPI } from "../helpers/mock-extension-api.js";
import { createTempGarden, type TempGarden } from "../helpers/temp-garden.js";

let temp: TempGarden;
let api: MockExtensionAPI;

beforeEach(async () => {
	temp = createTempGarden();
	// Create Objects directory
	fs.mkdirSync(path.join(temp.gardenDir, "Objects"), { recursive: true });
	api = createMockExtensionAPI();
	const mod = await import("../../core/extensions/bloom-objects/index.js");
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
describe("bloom-objects registration", () => {
	it("registers exactly 5 tools", () => {
		expect(api._registeredTools).toHaveLength(5);
	});

	it("registers the expected tool names", () => {
		expect(toolNames()).toEqual(["memory_create", "memory_read", "memory_search", "memory_link", "memory_list"]);
	});

	it("has no session_start event handler", () => {
		expect(api._eventHandlers.has("session_start")).toBe(false);
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
		const filepath = path.join(temp.gardenDir, "Objects", "test-note.md");
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
