import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { createMockExtensionAPI, type MockExtensionAPI } from "../helpers/mock-extension-api.js";
import { createMockExtensionContext } from "../helpers/mock-extension-context.js";
import { createTempNixPi, type TempNixPi } from "../helpers/temp-nixpi.js";

vi.mock("../../core/lib/exec.js", () => ({
	run: vi.fn(),
}));

import * as execModule from "../../core/lib/exec.js";
import {
	handleNixosUpdate,
	handleSystemdControl,
	handleUpdateStatus,
} from "../../core/pi/extensions/os/actions.js";
import { handleSystemHealth } from "../../core/pi/extensions/os/actions-health.js";

let temp: TempNixPi;
let api: MockExtensionAPI;

const EXPECTED_TOOL_NAMES = [
	"nixos_update",
	"nix_config_proposal",
	"systemd_control",
	"update_status",
	"schedule_reboot",
	"system_health",
];

beforeEach(async () => {
	temp = createTempNixPi();
	api = createMockExtensionAPI();
	const mod = await import("../../core/pi/extensions/os/index.js");
	mod.default(api as never);
});

afterEach(() => {
	temp.cleanup();
});

function toolNames(): string[] {
	return api._registeredTools.map((t) => t.name as string);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
describe("os registration", () => {
	it("registers exactly 6 tools", () => {
		expect(api._registeredTools).toHaveLength(6);
	});

	it("registers all expected tool names", () => {
		expect(toolNames()).toEqual(EXPECTED_TOOL_NAMES);
	});

	it("has before_agent_start event handler", () => {
		const events = [...api._eventHandlers.keys()];
		expect(events).toContain("before_agent_start");
	});
});

// ---------------------------------------------------------------------------
// Tool structure validation
// ---------------------------------------------------------------------------
describe("os tool structure", () => {
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

	it("each tool has a non-empty description", () => {
		for (const tool of api._registeredTools) {
			expect(typeof tool.description).toBe("string");
			expect((tool.description as string).length).toBeGreaterThan(0);
		}
	});

	it("each tool has a non-empty label", () => {
		for (const tool of api._registeredTools) {
			expect(typeof tool.label).toBe("string");
			expect((tool.label as string).length).toBeGreaterThan(0);
		}
	});

	it("tool names are unique", () => {
		const names = toolNames();
		expect(new Set(names).size).toBe(names.length);
	});
	it("does not register the legacy container tool", () => {
		expect(toolNames()).not.toContain("container");
	});
});

// ---------------------------------------------------------------------------
// Action handler tests
// ---------------------------------------------------------------------------

const mockRun = vi.mocked(execModule.run);

describe("handleNixosUpdate — status", () => {
	it("returns generation list on exit 0", async () => {
		mockRun.mockResolvedValueOnce({ stdout: "gen1\ngen2", stderr: "", exitCode: 0 });
		const result = await handleNixosUpdate("status", undefined, {} as never);
		expect(result.content[0].text).toContain("gen1");
	});

	it("returns stderr on non-zero exit", async () => {
		mockRun.mockResolvedValueOnce({ stdout: "", stderr: "permission denied", exitCode: 1 });
		const result = await handleNixosUpdate("status", undefined, {} as never);
		expect(result.content[0].text).toContain("permission denied");
	});
});

describe("handleNixosUpdate — rollback", () => {
	it("returns success message on exit 0", async () => {
		const ctx = createMockExtensionContext();
		mockRun.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });
		const result = await handleNixosUpdate("rollback", undefined, ctx as never);
		expect(result.content[0].text).toContain("Rolled back");
	});
});

describe("handleNixosUpdate — apply (missing system flake)", () => {
	it("returns error when /etc/nixos/flake.nix is absent and guides operators to /srv/nixpi main", async () => {
		vi.spyOn(fs, "existsSync").mockReturnValue(false);
		const ctx = createMockExtensionContext();
		const result = await handleNixosUpdate("apply", undefined, ctx as never);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("System flake not found at /etc/nixos");
		expect(result.content[0].text).toContain("/srv/nixpi");
		expect(result.content[0].text).toContain("switch to main");
	});
});

describe("handleNixosUpdate — apply (wrong canonical branch)", () => {
	it("returns error when /srv/nixpi is not on main", async () => {
		vi.spyOn(fs, "existsSync").mockReturnValue(true);
		mockRun.mockResolvedValueOnce({ stdout: "feature/test\n", stderr: "", exitCode: 0 });
		const ctx = createMockExtensionContext();
		const result = await handleNixosUpdate("apply", undefined, ctx as never);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Supported rebuilds require /srv/nixpi to be on main");
		expect(result.content[0].text).toContain("switch to main");
	});
});

describe("handleSystemdControl", () => {
	it("rejects non-nixpi services", async () => {
		const ctx = createMockExtensionContext();
		const result = await handleSystemdControl("sshd", "status", undefined, ctx as never);
		expect(result.isError).toBe(true);
	});

	it("runs systemctl for nixpi-chat status", async () => {
		mockRun.mockResolvedValueOnce({ stdout: "active", stderr: "", exitCode: 0 });
		const ctx = createMockExtensionContext();
		const result = await handleSystemdControl("nixpi-chat", "status", undefined, ctx as never);
		expect(result.content[0].text).toContain("active");
	});
});

describe("handleUpdateStatus", () => {
	it("returns a defined text result (file absent case)", async () => {
		const result = await handleUpdateStatus();
		expect(result.content[0].text).toBeDefined();
	});
});

describe("handleSystemHealth", () => {
	it("returns text content with OS section on success", async () => {
		mockRun
			.mockResolvedValueOnce({ stdout: "gen1 (current)\ngen2", stderr: "", exitCode: 0 }) // nixos-rebuild
			.mockResolvedValueOnce({ stdout: "[]", stderr: "", exitCode: 0 }) // podman ps
			.mockResolvedValueOnce({ stdout: "Filesystem\n/dev 1G 500M", stderr: "", exitCode: 0 }) // df
			.mockResolvedValueOnce({ stdout: "0.10 0.20 0.30 1/100 12345", stderr: "", exitCode: 0 }) // /proc/loadavg
			.mockResolvedValueOnce({ stdout: "Mem: 4G 2G 2G\n", stderr: "", exitCode: 0 }) // free
			.mockResolvedValueOnce({ stdout: "up 2 hours", stderr: "", exitCode: 0 }); // uptime
		const result = await handleSystemHealth(undefined);
		expect(result.content[0].text).toContain("## OS");
		expect(result.content[0].text).toContain("gen1 (current)");
	});

	it("returns text content even when all commands fail", async () => {
		mockRun.mockResolvedValue({ stdout: "", stderr: "error", exitCode: 1 });
		const result = await handleSystemHealth(undefined);
		expect(result.content[0].text).toContain("## OS");
		expect(result.content[0].text).toContain("nixos-rebuild unavailable");
	});

	it("includes container info when podman returns containers", async () => {
		mockRun
			.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 1 }) // nixos-rebuild fails
			.mockResolvedValueOnce({
				stdout: JSON.stringify([{ Names: ["nixpi-element-web"], Status: "Up 1 hour" }]),
				stderr: "",
				exitCode: 0,
			}) // podman ps
			.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 1 }) // df
			.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 1 }) // loadavg
			.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 1 }) // free
			.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 1 }); // uptime
		const result = await handleSystemHealth(undefined);
		expect(result.content[0].text).toContain("nixpi-element-web");
		expect(result.content[0].text).toContain("Up 1 hour");
	});

	it("handles podman JSON parse error gracefully", async () => {
		mockRun
			.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 1 }) // nixos-rebuild
			.mockResolvedValueOnce({ stdout: "not-json", stderr: "", exitCode: 0 }) // podman ps — bad JSON
			.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 1 }) // df
			.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 1 }) // loadavg
			.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 1 }) // free
			.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 1 }); // uptime
		const result = await handleSystemHealth(undefined);
		expect(result.content[0].text).toContain("parse error");
	});
});
