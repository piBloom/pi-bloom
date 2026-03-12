import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	handleDevBuild,
	handleDevLoop,
	handleDevRollback,
	handleDevSwitch,
} from "../../extensions/bloom-dev/actions-build.js";
import {
	handleDevCodeServer,
	handleDevDisable,
	handleDevEnable,
	handleDevStatus,
	isDevEnabled,
} from "../../extensions/bloom-dev/actions-lifecycle.js";
import {
	handleDevInstallPackage,
	handleDevPushExtension,
	handleDevPushService,
	handleDevPushSkill,
	handleDevSubmitPr,
	handleDevTest,
	isImmutableGlobalNpmError,
} from "../../extensions/bloom-dev/actions-pr.js";
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
		const result = (await (devBuild?.execute as (...args: unknown[]) => Promise<unknown>)(
			"call-id",
			{},
			undefined,
		)) as { isError?: boolean; content: Array<{ text: string }> };
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Dev mode is not enabled");
	});
});

// ---------------------------------------------------------------------------
// Task 5: dev_code_server handler
// ---------------------------------------------------------------------------
describe("handleDevCodeServer", () => {
	it("status returns a result (not 'not yet implemented')", async () => {
		const result = await handleDevCodeServer("status");
		const text = result.content[0].text;
		expect(text).not.toContain("Not yet implemented");
		expect(text).toMatch(/code-server is (running|stopped)/);
	});
});

// ---------------------------------------------------------------------------
// Task 6: dev_build handler
// ---------------------------------------------------------------------------
describe("handleDevBuild", () => {
	it("returns error when repo dir is missing", async () => {
		const missing = join(temp.gardenDir, "nonexistent");
		const result = await handleDevBuild(missing);
		expect("isError" in result && result.isError).toBe(true);
		expect(result.content[0].text).toContain("Containerfile not found");
	});
});

// ---------------------------------------------------------------------------
// Task 8: dev_test handler
// ---------------------------------------------------------------------------
describe("handleDevTest", () => {
	it("returns error when repo dir is missing", async () => {
		const missing = join(temp.gardenDir, "nonexistent");
		const result = await handleDevTest(missing);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("package.json not found");
	});
});

// ---------------------------------------------------------------------------
// Task 9: dev_loop handler
// ---------------------------------------------------------------------------
describe("handleDevLoop", () => {
	it("returns error when repo dir is missing", async () => {
		const result = await handleDevLoop({});
		expect("isError" in result && result.isError).toBe(true);
		expect(result.content[0].text).toContain("Repo directory not configured");
	});

	it("returns error when repo dir has no Containerfile", async () => {
		const missing = join(temp.gardenDir, "nonexistent-repo");
		const result = await handleDevLoop({}, undefined, undefined, missing);
		expect("isError" in result && result.isError).toBe(true);
		expect(result.content[0].text).toContain("Containerfile not found");
	});
});

// ---------------------------------------------------------------------------
// Task 10: dev_submit_pr handler
// ---------------------------------------------------------------------------
describe("handleDevSubmitPr", () => {
	it("returns error when repo dir has no .git", async () => {
		const missing = join(temp.gardenDir, "no-repo");
		const result = await handleDevSubmitPr({ title: "test" }, missing);
		expect("isError" in result && result.isError).toBe(true);
		expect(result.content[0].text).toContain("No .git directory found");
	});
});

// ---------------------------------------------------------------------------
// Task 11: dev_push_skill handler
// ---------------------------------------------------------------------------
describe("handleDevPushSkill", () => {
	it("returns error when skill is not found", async () => {
		const repoDir = join(temp.gardenDir, "repo");
		const result = await handleDevPushSkill({ skill_name: "nonexistent-skill" }, repoDir);
		expect("isError" in result && result.isError).toBe(true);
		expect(result.content[0].text).toContain("Skill not found");
	});
});

// ---------------------------------------------------------------------------
// Task 12: dev_install_package handler
// ---------------------------------------------------------------------------
describe("handleDevInstallPackage", () => {
	it("returns error for empty source", async () => {
		const result = await handleDevInstallPackage({ source: "" });
		expect("isError" in result && result.isError).toBe(true);
		expect(result.content[0].text).toContain("non-empty");
	});

	it("returns error for whitespace-only source", async () => {
		const result = await handleDevInstallPackage({ source: "   " });
		expect("isError" in result && result.isError).toBe(true);
		expect(result.content[0].text).toContain("non-empty");
	});
});

describe("isImmutableGlobalNpmError", () => {
	it("detects read-only global npm install failures under /usr/local", () => {
		const out = "npm ERR! code EROFS\nnpm ERR! path /usr/local/lib/node_modules/pi-teams\nRead-only file system";
		expect(isImmutableGlobalNpmError(out)).toBe(true);
	});

	it("detects ENOENT mkdir failures under /usr/local/lib/node_modules", () => {
		const out = "ENOENT: no such file or directory, mkdir '/usr/local/lib/node_modules/pi-teams'";
		expect(isImmutableGlobalNpmError(out)).toBe(true);
	});

	it("does not flag unrelated install errors", () => {
		const out = "npm ERR! 404 Not Found - GET https://registry.npmjs.org/some-missing-pkg";
		expect(isImmutableGlobalNpmError(out)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Error-path tests for validation and missing resources
// ---------------------------------------------------------------------------
describe("handleDevSwitch validation", () => {
	it("rejects image ref starting with '-'", async () => {
		const result = await handleDevSwitch("--malicious-flag", undefined, {} as never);
		expect("isError" in result && result.isError).toBe(true);
		expect(result.content[0].text).toContain("must not start with '-'");
	});

	it("rejects image ref starting with '--'", async () => {
		const result = await handleDevSwitch("--rm", undefined, {} as never);
		expect("isError" in result && result.isError).toBe(true);
		expect(result.content[0].text).toContain("must not start with '-'");
	});
});

describe("handleDevRollback", () => {
	it("does not crash when called without UI context", async () => {
		const result = await handleDevRollback(undefined, {} as never);
		// Without a real UI context, requireConfirmation should return an error string (no crash)
		expect(result).toBeDefined();
		expect(result.content).toBeDefined();
		expect(result.content.length).toBeGreaterThan(0);
	});
});

describe("handleDevPushService", () => {
	it("returns error when service is not found", async () => {
		const repoDir = join(temp.gardenDir, "repo");
		const result = await handleDevPushService({ service_name: "nonexistent-service" }, repoDir);
		expect("isError" in result && result.isError).toBe(true);
		expect(result.content[0].text).toContain("not found");
	});
});

describe("handleDevPushExtension", () => {
	it("returns error when extension is not found", async () => {
		const repoDir = join(temp.gardenDir, "repo");
		const result = await handleDevPushExtension({ extension_name: "nonexistent-ext" }, repoDir);
		expect("isError" in result && result.isError).toBe(true);
		expect(result.content[0].text).toContain("not found");
	});
});
