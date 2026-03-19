import { readFileSync } from "node:fs";
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

describe("runtime package extension list", () => {
	it("ships a curated default extension set", () => {
		const packageJson = JSON.parse(readFileSync("package.json", "utf-8")) as {
			pi?: { extensions?: string[] };
		};
		const extensionList = packageJson.pi?.extensions ?? [];

		expect(extensionList).toEqual([
			"./core/pi-extensions/bloom-persona",
			"./core/pi-extensions/bloom-localai",
			"./core/pi-extensions/bloom-os",
			"./core/pi-extensions/bloom-episodes",
			"./core/pi-extensions/bloom-objects",
			"./core/pi-extensions/bloom-garden",
			"./core/pi-extensions/bloom-setup",
		]);
		expect(extensionList).not.toContain("./core/pi-extensions/bloom-dev");
		expect(extensionList).not.toContain("./core/pi-extensions/bloom-repo");
		expect(extensionList).not.toContain("./core/pi-extensions/bloom-services");
	});
});

// ---------------------------------------------------------------------------
// bloom-garden
// ---------------------------------------------------------------------------
describe("bloom-garden registration", () => {
	it("registers expected tools, commands, and events", async () => {
		const mod = await import("../../core/pi-extensions/bloom-garden/index.js");
		const api = createMockExtensionAPI();
		mod.default(api as never);

		expect(toolNames(api)).toEqual(["garden_status"]);
		expect(commandNames(api)).toEqual(["bloom"]);
		expect(eventNames(api)).toEqual(expect.arrayContaining(["session_start", "resources_discover"]));
		expect(eventNames(api)).not.toContain("input");
	});
});

// ---------------------------------------------------------------------------
// bloom-episodes
// ---------------------------------------------------------------------------
describe("bloom-episodes registration", () => {
	it("registers episodic tools without events", async () => {
		const mod = await import("../../core/pi-extensions/bloom-episodes/index.js");
		const api = createMockExtensionAPI();
		mod.default(api as never);

		expect(toolNames(api)).toEqual(
			expect.arrayContaining(["episode_create", "episode_list", "episode_promote", "episode_consolidate"]),
		);
		expect(eventNames(api)).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// bloom-objects
// ---------------------------------------------------------------------------
describe("bloom-objects registration", () => {
	it("registers expected tools (no events)", async () => {
		const mod = await import("../../core/pi-extensions/bloom-objects/index.js");
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
		expect(toolNames(api)).not.toContain("garden_reindex");
		expect(eventNames(api)).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// bloom-os
// ---------------------------------------------------------------------------
describe("bloom-os registration", () => {
	it("registers tools and events", async () => {
		const mod = await import("../../core/pi-extensions/bloom-os/index.js");
		const api = createMockExtensionAPI();
		mod.default(api as never);

		expect(toolNames(api)).toEqual(expect.arrayContaining(["nixos_update", "nix_config_proposal", "systemd_control"]));
		expect(toolNames(api)).not.toContain("container");
		expect(eventNames(api)).toEqual(expect.arrayContaining(["before_agent_start"]));
	});
});

// ---------------------------------------------------------------------------
// bloom-persona
// ---------------------------------------------------------------------------
describe("bloom-persona registration", () => {
	it("registers events only (no tools/commands)", async () => {
		const mod = await import("../../core/pi-extensions/bloom-persona/index.js");
		const api = createMockExtensionAPI();
		mod.default(api as never);

		expect(toolNames(api)).toEqual([]);
		expect(commandNames(api)).toEqual([]);
		expect(eventNames(api)).toEqual(
			expect.arrayContaining(["session_start", "before_agent_start", "tool_call", "session_before_compact"]),
		);
	});
});
