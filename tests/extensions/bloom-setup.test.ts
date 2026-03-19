import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockExtensionAPI, type MockExtensionAPI } from "../helpers/mock-extension-api.js";
import { createTempGarden, type TempGarden } from "../helpers/temp-garden.js";

const runMock = vi.fn();

vi.mock("../../core/lib/exec.js", () => ({
	run: (...args: unknown[]) => runMock(...args),
}));

let temp: TempGarden;
let api: MockExtensionAPI;
let originalHome: string | undefined;

const EXPECTED_TOOL_NAMES = ["setup_status", "setup_advance", "setup_reset"];

beforeEach(async () => {
	temp = createTempGarden();
	api = createMockExtensionAPI();
	originalHome = process.env.HOME;
	process.env.HOME = temp.gardenDir;
	runMock.mockReset();
	runMock.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
	vi.resetModules();
});

afterEach(() => {
	if (originalHome === undefined) {
		process.env.HOME = undefined;
	} else {
		process.env.HOME = originalHome;
	}
	temp.cleanup();
});

async function loadExtension() {
	const mod = await import("../../core/pi-extensions/bloom-setup/index.js");
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

// ---------------------------------------------------------------------------
// Startup gating
// ---------------------------------------------------------------------------
describe("bloom-setup startup gating", () => {
	it("injects a setup-first prompt after the wizard completes and persona is still pending", async () => {
		mkdirSync(path.join(os.homedir(), ".bloom"), { recursive: true });
		writeFileSync(path.join(os.homedir(), ".bloom", ".setup-complete"), "done", "utf-8");

		await loadExtension();
		const result = await api.fireEvent("before_agent_start", { systemPrompt: "BASE_PROMPT" });

		expect(result).toEqual({
			systemPrompt: expect.stringContaining(
				"Before sending any normal reply in this session, you must call setup_status()",
			),
		});
		expect((result as { systemPrompt: string }).systemPrompt).toContain(
			"Your first action for this session is setup_status().",
		);
		expect((result as { systemPrompt: string }).systemPrompt).toContain("BASE_PROMPT");
	});

	it("does not inject setup guidance after persona setup is already complete", async () => {
		mkdirSync(path.join(os.homedir(), ".bloom", "wizard-state"), { recursive: true });
		writeFileSync(path.join(os.homedir(), ".bloom", ".setup-complete"), "done", "utf-8");
		writeFileSync(path.join(os.homedir(), ".bloom", "wizard-state", "persona-done"), "done", "utf-8");

		await loadExtension();
		const result = await api.fireEvent("before_agent_start", { systemPrompt: "BASE_PROMPT" });

		expect(result).toBeUndefined();
	});
});

describe("setup_advance daemon reconciliation", () => {
	it("enables pi-daemon when setup completes", async () => {
		mkdirSync(path.join(os.homedir(), ".bloom"), { recursive: true });
		writeFileSync(path.join(os.homedir(), ".bloom", ".setup-complete"), "done", "utf-8");

		await loadExtension();
		const tool = api._registeredTools.find((entry) => entry.name === "setup_advance") as {
			execute: (
				toolCallId: string,
				params: { step: "persona"; result: "completed" },
			) => Promise<{
				content: Array<{ text: string }>;
			}>;
		};

		const result = await tool.execute("tool-call", { step: "persona", result: "completed" });

		expect(runMock).toHaveBeenCalledWith("systemctl", ["--user", "enable", "--now", "pi-daemon.service"]);
		expect(result.content[0]?.text).toContain("`pi-daemon.service` was enabled and started.");
	});
});
