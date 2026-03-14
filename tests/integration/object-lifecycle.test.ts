import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseFrontmatter } from "../../core/lib/frontmatter.js";
import { createMockExtensionAPI } from "../helpers/mock-extension-api.js";
import { createMockExtensionContext } from "../helpers/mock-extension-context.js";
import { createTempGarden, type TempGarden } from "../helpers/temp-garden.js";

let temp: TempGarden;

beforeEach(() => {
	temp = createTempGarden();
	// Create Objects directory
	mkdirSync(join(temp.gardenDir, "Objects"), { recursive: true });
});

afterEach(() => {
	temp.cleanup();
});

async function setupObjectsExtension() {
	const mod = await import("../../core/extensions/bloom-objects/index.js");
	const api = createMockExtensionAPI();
	const ctx = createMockExtensionContext();
	mod.default(api as never);
	return { api, ctx };
}

function findTool(api: ReturnType<typeof createMockExtensionAPI>, name: string) {
	const tool = api._registeredTools.find((t) => t.name === name);
	if (!tool) throw new Error(`Tool ${name} not found`);
	return tool;
}

async function executeTool(
	api: ReturnType<typeof createMockExtensionAPI>,
	toolName: string,
	params: Record<string, unknown>,
) {
	const tool = findTool(api, toolName);
	const execute = tool.execute as (
		toolCallId: string,
		params: Record<string, unknown>,
		signal: undefined,
		onUpdate: undefined,
		ctx: unknown,
	) => Promise<{ content: Array<{ type: string; text: string }>; details: Record<string, unknown>; isError?: boolean }>;
	return execute("test-call-id", params, undefined, undefined, createMockExtensionContext());
}

describe("object lifecycle", () => {
	it("memory_create creates a file with frontmatter", async () => {
		const { api } = await setupObjectsExtension();
		const result = await executeTool(api, "memory_create", {
			type: "task",
			slug: "fix-bike",
			fields: { title: "Fix bike tire" },
		});

		expect(result.isError).toBeUndefined();
		expect(result.content[0].text).toContain("created task/fix-bike");

		const filepath = join(temp.gardenDir, "Objects", "fix-bike.md");
		expect(existsSync(filepath)).toBe(true);

		const raw = readFileSync(filepath, "utf-8");
		const parsed = parseFrontmatter(raw);
		expect(parsed.attributes).toMatchObject({
			type: "task",
			slug: "fix-bike",
			title: "Fix bike tire",
		});
	});

	it("memory_read returns created object content", async () => {
		const { api } = await setupObjectsExtension();
		await executeTool(api, "memory_create", {
			type: "note",
			slug: "test-note",
		});

		const result = await executeTool(api, "memory_read", {
			type: "note",
			slug: "test-note",
		});
		expect(result.isError).toBeUndefined();
		expect(result.content[0].text).toContain("type: note");
		expect(result.content[0].text).toContain("slug: test-note");
	});

	it("memory_link creates bidirectional links", async () => {
		const { api } = await setupObjectsExtension();

		await executeTool(api, "memory_create", { type: "task", slug: "a" });
		await executeTool(api, "memory_create", { type: "task", slug: "b" });

		const result = await executeTool(api, "memory_link", {
			ref_a: "task/a",
			ref_b: "task/b",
		});
		expect(result.content[0].text).toContain("linked");

		// Verify bidirectional
		const readA = await executeTool(api, "memory_read", { type: "task", slug: "a" });
		const readB = await executeTool(api, "memory_read", { type: "task", slug: "b" });
		expect(readA.content[0].text).toContain("task/b");
		expect(readB.content[0].text).toContain("task/a");
	});

	it("memory_list finds created objects", async () => {
		const { api } = await setupObjectsExtension();

		await executeTool(api, "memory_create", {
			type: "task",
			slug: "list-test",
			fields: { title: "Listed Task" },
		});

		const result = await executeTool(api, "memory_list", { type: "task" });
		expect(result.content[0].text).toContain("task/list-test");
	});

	it("memory_create rejects duplicate", async () => {
		const { api } = await setupObjectsExtension();

		await executeTool(api, "memory_create", { type: "note", slug: "dup" });
		const result = await executeTool(api, "memory_create", { type: "note", slug: "dup" });
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("already exists");
	});
});
