import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockExtensionAPI, type MockExtensionAPI } from "../helpers/mock-extension-api.js";
import { createTempGarden, type TempGarden } from "../helpers/temp-garden.js";

let temp: TempGarden;

beforeEach(() => {
	temp = createTempGarden();
});

afterEach(() => {
	temp.cleanup();
});

function toolNames(api: MockExtensionAPI): string[] {
	return api._registeredTools.map((t) => t.name as string);
}

function commandNames(api: MockExtensionAPI): string[] {
	return api._registeredCommands.map((c) => c.name);
}

function eventNames(api: MockExtensionAPI): string[] {
	return [...api._eventHandlers.keys()];
}

// ---------------------------------------------------------------------------
// bloom-audit
// ---------------------------------------------------------------------------
describe("bloom-audit registration", () => {
	it("registers expected tools and events", async () => {
		const mod = await import("../../core/extensions/bloom-audit/index.js");
		const api = createMockExtensionAPI();
		mod.default(api as never);

		expect(toolNames(api)).toEqual(["audit_review"]);
		expect(commandNames(api)).toEqual([]);
		expect(eventNames(api)).toEqual(expect.arrayContaining(["session_start", "tool_call", "tool_result"]));
	});
});

// ---------------------------------------------------------------------------
// bloom-garden
// ---------------------------------------------------------------------------
describe("bloom-garden registration", () => {
	it("registers expected tools, commands, and events", async () => {
		const mod = await import("../../core/extensions/bloom-garden/index.js");
		const api = createMockExtensionAPI();
		mod.default(api as never);

		expect(toolNames(api)).toEqual(
			expect.arrayContaining(["garden_status", "skill_create", "skill_list", "persona_evolve"]),
		);
		expect(commandNames(api)).toEqual(["bloom"]);
		expect(eventNames(api)).toEqual(expect.arrayContaining(["session_start", "resources_discover"]));
	});
});

// ---------------------------------------------------------------------------
// bloom-objects
// ---------------------------------------------------------------------------
describe("bloom-objects registration", () => {
	it("registers expected tools (no events)", async () => {
		const mod = await import("../../core/extensions/bloom-objects/index.js");
		const api = createMockExtensionAPI();
		mod.default(api as never);

		expect(toolNames(api)).toEqual(
			expect.arrayContaining(["memory_create", "memory_read", "memory_search", "memory_link", "memory_list"]),
		);
		expect(toolNames(api)).not.toContain("memory_move");
		expect(toolNames(api)).not.toContain("garden_reindex");
		expect(eventNames(api)).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// bloom-os
// ---------------------------------------------------------------------------
describe("bloom-os registration", () => {
	it("registers tools and events", async () => {
		const mod = await import("../../core/extensions/bloom-os/index.js");
		const api = createMockExtensionAPI();
		mod.default(api as never);

		expect(toolNames(api)).toEqual(expect.arrayContaining(["bootc", "container", "systemd_control"]));
		expect(eventNames(api)).toEqual(expect.arrayContaining(["before_agent_start"]));
	});
});

// ---------------------------------------------------------------------------
// bloom-repo
// ---------------------------------------------------------------------------
describe("bloom-repo registration", () => {
	it("registers expected tools", async () => {
		const mod = await import("../../extensions/bloom-repo/index.js");
		const api = createMockExtensionAPI();
		mod.default(api as never);

		expect(toolNames(api)).toEqual(expect.arrayContaining(["bloom_repo", "bloom_repo_submit_pr"]));
	});
});

// ---------------------------------------------------------------------------
// bloom-persona
// ---------------------------------------------------------------------------
describe("bloom-persona registration", () => {
	it("registers events only (no tools/commands)", async () => {
		const mod = await import("../../core/extensions/bloom-persona/index.js");
		const api = createMockExtensionAPI();
		mod.default(api as never);

		expect(toolNames(api)).toEqual([]);
		expect(commandNames(api)).toEqual([]);
		expect(eventNames(api)).toEqual(
			expect.arrayContaining(["session_start", "before_agent_start", "tool_call", "session_before_compact"]),
		);
	});
});

// ---------------------------------------------------------------------------
// bloom-services
// ---------------------------------------------------------------------------
describe("bloom-services registration", () => {
	it("registers expected tools and events", async () => {
		const mod = await import("../../core/extensions/bloom-services/index.js");
		const api = createMockExtensionAPI();
		mod.default(api as never);

		expect(toolNames(api)).toEqual(
			expect.arrayContaining([
				"service_scaffold",
				"service_install",
				"service_test",
				"manifest_show",
				"manifest_sync",
				"manifest_set_service",
				"manifest_apply",
			]),
		);
		expect(eventNames(api)).toEqual(expect.arrayContaining(["session_start"]));
	});
});
