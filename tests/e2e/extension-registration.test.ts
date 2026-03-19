import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockExtensionAPI, type MockExtensionAPI } from "../helpers/mock-extension-api.js";
import { createTempWorkspace, type TempWorkspace } from "../helpers/temp-workspace.js";

let temp: TempWorkspace;

beforeEach(() => {
	temp = createTempWorkspace();
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

describe("runtime package extension list", () => {
	it("ships a curated default extension set", () => {
		const packageJson = JSON.parse(readFileSync("package.json", "utf-8")) as {
			pi?: { extensions?: string[] };
		};
		const extensionList = packageJson.pi?.extensions ?? [];

		expect(extensionList).toEqual([
			"./core/pi/extensions/persona",
			"./core/pi/extensions/localai",
			"./core/pi/extensions/os",
			"./core/pi/extensions/episodes",
			"./core/pi/extensions/objects",
			"./core/pi/extensions/workspace",
			"./core/pi/extensions/setup",
		]);
		expect(extensionList).not.toContain("./core/pi/extensions/workspace-dev");
		expect(extensionList).not.toContain("./core/pi/extensions/workspace-repo");
		expect(extensionList).not.toContain("./core/pi/extensions/workspace-services");
	});
});

// ---------------------------------------------------------------------------
// workspace
// ---------------------------------------------------------------------------
describe("workspace registration", () => {
	it("registers expected tools, commands, and events", async () => {
		const mod = await import("../../core/pi/extensions/workspace/index.js");
		const api = createMockExtensionAPI();
		mod.default(api as never);

		expect(toolNames(api)).toEqual(["workspace_status"]);
		expect(commandNames(api)).toEqual(["workspace"]);
		expect(eventNames(api)).toEqual(expect.arrayContaining(["session_start", "resources_discover"]));
		expect(eventNames(api)).not.toContain("input");
	});
});

// ---------------------------------------------------------------------------
// episodes
// ---------------------------------------------------------------------------
describe("episodes registration", () => {
	it("registers episodic tools without events", async () => {
		const mod = await import("../../core/pi/extensions/episodes/index.js");
		const api = createMockExtensionAPI();
		mod.default(api as never);

		expect(toolNames(api)).toEqual(
			expect.arrayContaining(["episode_create", "episode_list", "episode_promote", "episode_consolidate"]),
		);
		expect(eventNames(api)).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// objects
// ---------------------------------------------------------------------------
describe("objects registration", () => {
	it("registers expected tools (no events)", async () => {
		const mod = await import("../../core/pi/extensions/objects/index.js");
		const api = createMockExtensionAPI();
		mod.default(api as never);

		expect(toolNames(api)).toEqual(
			expect.arrayContaining([
				"memory_create",
				"memory_update",
				"memory_upsert",
				"memory_read",
				"memory_query",
				"memory_search",
				"memory_link",
				"memory_list",
			]),
		);
		expect(toolNames(api)).not.toContain("memory_move");
		expect(toolNames(api)).not.toContain("workspace_reindex");
		expect(eventNames(api)).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// os
// ---------------------------------------------------------------------------
describe("os registration", () => {
	it("registers tools and events", async () => {
		const mod = await import("../../core/pi/extensions/os/index.js");
		const api = createMockExtensionAPI();
		mod.default(api as never);

		expect(toolNames(api)).toEqual(expect.arrayContaining(["nixos_update", "nix_config_proposal", "systemd_control"]));
		expect(toolNames(api)).not.toContain("container");
		expect(eventNames(api)).toEqual(expect.arrayContaining(["before_agent_start"]));
	});
});

// ---------------------------------------------------------------------------
// persona
// ---------------------------------------------------------------------------
describe("persona registration", () => {
	it("registers events only (no tools/commands)", async () => {
		const mod = await import("../../core/pi/extensions/persona/index.js");
		const api = createMockExtensionAPI();
		mod.default(api as never);

		expect(toolNames(api)).toEqual([]);
		expect(commandNames(api)).toEqual([]);
		expect(eventNames(api)).toEqual(
			expect.arrayContaining(["session_start", "before_agent_start", "tool_call", "session_before_compact"]),
		);
	});
});
