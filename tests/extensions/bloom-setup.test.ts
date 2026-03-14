import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockExtensionAPI, type MockExtensionAPI } from "../helpers/mock-extension-api.js";
import { createTempGarden, type TempGarden } from "../helpers/temp-garden.js";

let temp: TempGarden;
let api: MockExtensionAPI;

const EXPECTED_TOOL_NAMES = ["setup_status", "setup_advance", "setup_reset"];

beforeEach(async () => {
	temp = createTempGarden();
	api = createMockExtensionAPI();
});

afterEach(() => {
	temp.cleanup();
});

async function loadExtension() {
	const mod = await import("../../core/extensions/bloom-setup/index.js");
	mod.default(api as never);
}

function toolNames(): string[] {
	return api._registeredTools.map((t) => t.name as string);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
describe("bloom-setup registration", () => {
	it("registers exactly 3 tools", async () => {
		await loadExtension();
		expect(api._registeredTools).toHaveLength(3);
	});

	it("registers all expected tool names", async () => {
		await loadExtension();
		expect(toolNames()).toEqual(EXPECTED_TOOL_NAMES);
	});

	it("has before_agent_start event handler", async () => {
		await loadExtension();
		const events = [...api._eventHandlers.keys()];
		expect(events).toContain("before_agent_start");
	});
});

// ---------------------------------------------------------------------------
// Tool structure validation
// ---------------------------------------------------------------------------
describe("bloom-setup tool structure", () => {
	it("each tool has name, label, description, parameters, and execute", async () => {
		await loadExtension();
		for (const tool of api._registeredTools) {
			expect(tool, `tool ${tool.name} missing 'name'`).toHaveProperty("name");
			expect(tool, `tool ${tool.name} missing 'label'`).toHaveProperty("label");
			expect(tool, `tool ${tool.name} missing 'description'`).toHaveProperty("description");
			expect(tool, `tool ${tool.name} missing 'parameters'`).toHaveProperty("parameters");
			expect(tool, `tool ${tool.name} missing 'execute'`).toHaveProperty("execute");
			expect(typeof tool.execute, `tool ${tool.name} execute is not a function`).toBe("function");
		}
	});

	it("each tool has a non-empty description and label", async () => {
		await loadExtension();
		for (const tool of api._registeredTools) {
			expect((tool.description as string).length).toBeGreaterThan(0);
			expect((tool.label as string).length).toBeGreaterThan(0);
		}
	});

	it("tool names are unique", async () => {
		await loadExtension();
		const names = toolNames();
		expect(new Set(names).size).toBe(names.length);
	});
});
