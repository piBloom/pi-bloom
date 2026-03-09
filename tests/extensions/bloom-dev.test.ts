import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	handleDevDisable,
	handleDevEnable,
	handleDevStatus,
	isDevEnabled,
} from "../../extensions/bloom-dev/actions.js";
import type { DevBuildResult, DevStatus, DevTestResult } from "../../extensions/bloom-dev/types.js";
import { createMockExtensionAPI, type MockExtensionAPI } from "../helpers/mock-extension-api.js";
import { createTempGarden, type TempGarden } from "../helpers/temp-garden.js";

let temp: TempGarden;

beforeEach(() => {
	temp = createTempGarden();
});

afterEach(() => {
	temp.cleanup();
});

// ---------------------------------------------------------------------------
// Task 1: Type validation
// ---------------------------------------------------------------------------
describe("bloom-dev types", () => {
	it("DevStatus has required and optional fields", () => {
		const status: DevStatus = {
			enabled: false,
			repoConfigured: true,
			codeServerRunning: false,
			localBuildAvailable: false,
		};
		expect(status.enabled).toBe(false);
		expect(status.repoConfigured).toBe(true);
		expect(status.repoPath).toBeUndefined();
		expect(status.localImageTag).toBeUndefined();

		const full: DevStatus = {
			enabled: true,
			repoConfigured: true,
			codeServerRunning: true,
			localBuildAvailable: true,
			repoPath: "/home/pi/.bloom/pi-bloom",
			localImageTag: "localhost/bloom:dev",
		};
		expect(full.repoPath).toBe("/home/pi/.bloom/pi-bloom");
		expect(full.localImageTag).toBe("localhost/bloom:dev");
	});

	it("DevBuildResult has required and optional fields", () => {
		const result: DevBuildResult = {
			success: true,
			imageTag: "localhost/bloom:dev",
			duration: 120,
		};
		expect(result.success).toBe(true);
		expect(result.size).toBeUndefined();
		expect(result.error).toBeUndefined();

		const failed: DevBuildResult = {
			success: false,
			imageTag: "localhost/bloom:dev",
			duration: 5,
			error: "build failed",
		};
		expect(failed.error).toBe("build failed");
	});

	it("DevTestResult has all required fields", () => {
		const result: DevTestResult = {
			success: true,
			testsPassed: true,
			lintPassed: true,
			testOutput: "all tests passed",
			lintOutput: "no lint errors",
		};
		expect(result.success).toBe(true);
		expect(result.testOutput).toBe("all tests passed");
	});
});

// ---------------------------------------------------------------------------
// Task 2: Sentinel management
// ---------------------------------------------------------------------------
describe("bloom-dev sentinel management", () => {
	it("isDevEnabled returns false when sentinel is absent", () => {
		expect(isDevEnabled(temp.gardenDir)).toBe(false);
	});

	it("dev_enable writes the sentinel file", async () => {
		const result = await handleDevEnable(temp.gardenDir);
		expect(result).not.toHaveProperty("isError");
		expect(result.details.enabled).toBe(true);
		expect(isDevEnabled(temp.gardenDir)).toBe(true);
		expect(existsSync(join(temp.gardenDir, ".dev-enabled"))).toBe(true);
	});

	it("dev_disable removes the sentinel file", async () => {
		// First enable
		await handleDevEnable(temp.gardenDir);
		expect(isDevEnabled(temp.gardenDir)).toBe(true);

		// Then disable
		const result = await handleDevDisable(temp.gardenDir);
		expect(result).not.toHaveProperty("isError");
		expect(result.details.enabled).toBe(false);
		expect(isDevEnabled(temp.gardenDir)).toBe(false);
	});

	it("dev_disable is idempotent when sentinel already absent", async () => {
		const result = await handleDevDisable(temp.gardenDir);
		expect(result).not.toHaveProperty("isError");
		expect(result.details.enabled).toBe(false);
	});

	it("dev_status reports disabled when sentinel absent", async () => {
		const result = await handleDevStatus(temp.gardenDir);
		expect(result.details.enabled).toBe(false);
		expect(result.content[0].text).toContain("disabled");
	});

	it("dev_status reports enabled when sentinel present", async () => {
		await handleDevEnable(temp.gardenDir);
		const result = await handleDevStatus(temp.gardenDir);
		expect(result.details.enabled).toBe(true);
		expect(result.content[0].text).toContain("enabled");
	});
});

// ---------------------------------------------------------------------------
// Task 3: Extension registration
// ---------------------------------------------------------------------------

const ALL_TOOL_NAMES = [
	"dev_enable",
	"dev_disable",
	"dev_status",
	"dev_code_server",
	"dev_build",
	"dev_switch",
	"dev_rollback",
	"dev_loop",
	"dev_test",
	"dev_submit_pr",
	"dev_push_skill",
	"dev_push_service",
	"dev_push_extension",
	"dev_install_package",
];

describe("bloom-dev registration", () => {
	let api: MockExtensionAPI;

	beforeEach(async () => {
		api = createMockExtensionAPI();
		const mod = await import("../../extensions/bloom-dev/index.js");
		mod.default(api as never);
	});

	function toolNames(): string[] {
		return api._registeredTools.map((t) => t.name as string);
	}

	it("registers all expected tool names", () => {
		expect(toolNames()).toEqual(ALL_TOOL_NAMES);
	});

	it(`registers exactly ${ALL_TOOL_NAMES.length} tools`, () => {
		expect(api._registeredTools).toHaveLength(ALL_TOOL_NAMES.length);
	});

	it("each tool has name, label, description, parameters, and execute", () => {
		for (const tool of api._registeredTools) {
			expect(tool, `tool ${tool.name} missing 'name'`).toHaveProperty("name");
			expect(tool, `tool ${tool.name} missing 'label'`).toHaveProperty("label");
			expect(tool, `tool ${tool.name} missing 'description'`).toHaveProperty("description");
			expect(tool, `tool ${tool.name} missing 'parameters'`).toHaveProperty("parameters");
			expect(tool, `tool ${tool.name} missing 'execute'`).toHaveProperty("execute");
			expect(typeof tool.execute, `tool ${tool.name} execute is not a function`).toBe("function");
		}
	});

	it("each tool has a non-empty description and label", () => {
		for (const tool of api._registeredTools) {
			expect(typeof tool.description).toBe("string");
			expect((tool.description as string).length).toBeGreaterThan(0);
			expect(typeof tool.label).toBe("string");
			expect((tool.label as string).length).toBeGreaterThan(0);
		}
	});

	it("tool names are unique", () => {
		const names = toolNames();
		expect(new Set(names).size).toBe(names.length);
	});

	it("gated tool returns error when dev mode is not enabled", async () => {
		const devBuild = api._registeredTools.find((t) => t.name === "dev_build");
		expect(devBuild).toBeDefined();
		const result = (await (devBuild!.execute as (...args: unknown[]) => Promise<unknown>)(
			"call-id",
			{},
			undefined,
		)) as { isError?: boolean; content: Array<{ text: string }> };
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Dev mode is not enabled");
	});
});
