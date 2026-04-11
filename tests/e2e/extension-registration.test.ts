import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockExtensionAPI, type MockExtensionAPI } from "../helpers/mock-extension-api.js";
import { createTempNixPi, type TempNixPi } from "../helpers/temp-nixpi.js";

let temp: TempNixPi;

beforeEach(() => {
	temp = createTempNixPi();
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
			"./core/pi/extensions/os",
			"./core/pi/extensions/wiki",
			"./core/pi/extensions/nixpi",
			"./core/pi/extensions/exa",
		]);
	});
});

// ---------------------------------------------------------------------------
// nixpi
// ---------------------------------------------------------------------------
describe("nixpi registration", () => {
	it("registers expected tools, commands, and events", async () => {
		const mod = await import("../../core/pi/extensions/nixpi/index.js");
		const api = createMockExtensionAPI();
		mod.default(api as never);

		expect(toolNames(api)).toEqual(["nixpi_status"]);
		expect(commandNames(api)).toEqual(["nixpi"]);
		expect(eventNames(api)).toEqual(expect.arrayContaining(["session_start", "resources_discover"]));
	});
});

// ---------------------------------------------------------------------------
// exa
// ---------------------------------------------------------------------------
describe("exa registration", () => {
	it("registers expected tools, command, and event", async () => {
		const mod = await import("../../core/pi/extensions/exa/index.js");
		const api = createMockExtensionAPI();
		mod.default(api as never);

		expect(toolNames(api)).toEqual(
			expect.arrayContaining(["exa_search", "exa_fetch", "exa_code_context"]),
		);
		expect(commandNames(api)).toEqual(expect.arrayContaining(["exa-status"]));
		expect(eventNames(api)).toEqual(expect.arrayContaining(["session_start"]));
	});
});

// ---------------------------------------------------------------------------
// wiki
// ---------------------------------------------------------------------------
describe("wiki registration", () => {
	it("registers expected tools and events", async () => {
		const mod = await import("../../core/pi/extensions/wiki/index.js");
		const api = createMockExtensionAPI();
		mod.default(api as never);

		expect(toolNames(api)).toEqual(
			expect.arrayContaining([
				"wiki_status",
				"wiki_capture",
				"wiki_search",
				"wiki_ensure_page",
				"wiki_lint",
				"wiki_rebuild",
			]),
		);
		expect(eventNames(api)).toEqual(expect.arrayContaining(["tool_call", "agent_end", "before_agent_start"]));
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
