import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockExtensionAPI, type MockExtensionAPI } from "../helpers/mock-extension-api.js";
import { createMockExtensionContext } from "../helpers/mock-extension-context.js";
import { createTempNixPi, type TempNixPi } from "../helpers/temp-nixpi.js";

vi.mock("../../core/lib/exec.js", () => ({
	run: vi.fn(),
}));

import * as execModule from "../../core/lib/exec.js";
import {
	checkPendingUpdates,
	handleNixosUpdate,
	handleScheduleReboot,
	handleSystemdControl,
	handleUpdateStatus,
} from "../../core/pi/extensions/os/actions.js";
import { handleSystemHealth } from "../../core/pi/extensions/os/actions-health.js";

let temp: TempNixPi;
let api: MockExtensionAPI;
let origStateDir: string | undefined;
let origPrimaryUser: string | undefined;

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
	origStateDir = process.env.NIXPI_STATE_DIR;
	origPrimaryUser = process.env.NIXPI_PRIMARY_USER;
	process.env.NIXPI_STATE_DIR = path.join(temp.nixPiDir, ".nixpi");
	// Required when running tests as root so getPrimaryUser() doesn't throw.
	process.env.NIXPI_PRIMARY_USER = "test-user";
	api = createMockExtensionAPI();
	const mod = await import("../../core/pi/extensions/os/index.js");
	mod.default(api as never);
});

afterEach(() => {
	if (origStateDir !== undefined) {
		process.env.NIXPI_STATE_DIR = origStateDir;
	} else {
		delete process.env.NIXPI_STATE_DIR;
	}
	if (origPrimaryUser !== undefined) {
		process.env.NIXPI_PRIMARY_USER = origPrimaryUser;
	} else {
		delete process.env.NIXPI_PRIMARY_USER;
	}
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
		expect(result.content[0].text).toContain("standard /etc/nixos flake");
		expect(result.content[0].text).toContain("/srv/nixpi");
		expect(result.content[0].text).toContain("bootstrap");
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

	it("runs systemctl for nixpi-ttyd status", async () => {
		mockRun.mockResolvedValueOnce({ stdout: "active", stderr: "", exitCode: 0 });
		const ctx = createMockExtensionContext();
		const result = await handleSystemdControl("nixpi-ttyd", "status", undefined, ctx as never);
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
				stdout: JSON.stringify([{ Names: ["nixpi-ttyd"], Status: "Up 1 hour" }]),
				stderr: "",
				exitCode: 0,
			}) // podman ps
			.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 1 }) // df
			.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 1 }) // loadavg
			.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 1 }) // free
			.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 1 }); // uptime
		const result = await handleSystemHealth(undefined);
		expect(result.content[0].text).toContain("nixpi-ttyd");
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

	it("handles partial failures — nixos success but disk failure", async () => {
		mockRun
			.mockResolvedValueOnce({ stdout: "gen1 (current)", stderr: "", exitCode: 0 }) // nixos-rebuild succeeds
			.mockResolvedValueOnce({ stdout: "[]", stderr: "", exitCode: 0 }) // podman ps succeeds
			.mockResolvedValueOnce({ stdout: "", stderr: "df error", exitCode: 1 }) // df fails
			.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 1 }) // loadavg fails
			.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 1 }) // free fails
			.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 1 }); // uptime fails
		const result = await handleSystemHealth(undefined);
		expect(result.content[0].text).toContain("gen1 (current)");
		expect(result.content[0].text).toContain("## OS");
	});
});

// ---------------------------------------------------------------------------
// handleNixosUpdate — apply (success path)
// ---------------------------------------------------------------------------
describe("handleNixosUpdate — apply (success)", () => {
	it("returns success message when brokerctl apply succeeds", async () => {
		vi.spyOn(fs, "existsSync").mockReturnValue(true);
		mockRun
			.mockResolvedValueOnce({ stdout: "main\n", stderr: "", exitCode: 0 }) // git branch
			.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }); // brokerctl apply
		const ctx = createMockExtensionContext();
		const result = await handleNixosUpdate("apply", undefined, ctx as never);
		expect(result.isError).toBeFalsy();
		expect(result.content[0].text).toContain("Update applied successfully");
	});

	it("returns error message when brokerctl apply fails", async () => {
		vi.spyOn(fs, "existsSync").mockReturnValue(true);
		mockRun
			.mockResolvedValueOnce({ stdout: "main\n", stderr: "", exitCode: 0 }) // git branch
			.mockResolvedValueOnce({ stdout: "", stderr: "build failed", exitCode: 1 }); // brokerctl apply
		const ctx = createMockExtensionContext();
		const result = await handleNixosUpdate("apply", undefined, ctx as never);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("build failed");
	});

	it("returns error when git branch command fails", async () => {
		vi.spyOn(fs, "existsSync").mockReturnValue(true);
		mockRun.mockResolvedValueOnce({ stdout: "", stderr: "not a repo", exitCode: 128 }); // git branch fails
		const ctx = createMockExtensionContext();
		const result = await handleNixosUpdate("apply", undefined, ctx as never);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Failed to determine canonical repo branch");
	});
});

// ---------------------------------------------------------------------------
// handleNixosUpdate — confirmation denial
// ---------------------------------------------------------------------------
describe("handleNixosUpdate — confirmation denial", () => {
	it("returns error when user declines rollback confirmation", async () => {
		const ctx = { hasUI: true, ui: { confirm: vi.fn().mockResolvedValue(false) } } as never;
		const result = await handleNixosUpdate("rollback", undefined, ctx);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("declined");
	});
});

// ---------------------------------------------------------------------------
// handleSystemdControl — start / stop / restart
// ---------------------------------------------------------------------------
describe("handleSystemdControl — mutating actions", () => {
	it("runs start action on a valid nixpi service", async () => {
		mockRun.mockResolvedValueOnce({ stdout: "started", stderr: "", exitCode: 0 });
		const ctx = createMockExtensionContext();
		const result = await handleSystemdControl("nixpi-ttyd", "start", undefined, ctx as never);
		expect(result.isError).toBeFalsy();
		expect(result.content[0].text).toContain("started");
	});

	it("runs stop action on a valid nixpi service", async () => {
		mockRun.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });
		const ctx = createMockExtensionContext();
		const result = await handleSystemdControl("nixpi-ttyd", "stop", undefined, ctx as never);
		expect(result.isError).toBeFalsy();
	});

	it("runs restart action on a valid nixpi service", async () => {
		mockRun.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });
		const ctx = createMockExtensionContext();
		const result = await handleSystemdControl("nixpi-ttyd", "restart", undefined, ctx as never);
		expect(result.isError).toBeFalsy();
	});

	it("returns error when user declines start confirmation", async () => {
		const ctx = { hasUI: true, ui: { confirm: vi.fn().mockResolvedValue(false) } } as never;
		const result = await handleSystemdControl("nixpi-ttyd", "start", undefined, ctx);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("declined");
	});

	it("returns error on non-zero exit code", async () => {
		mockRun.mockResolvedValueOnce({ stdout: "", stderr: "unit not found", exitCode: 5 });
		const ctx = createMockExtensionContext();
		const result = await handleSystemdControl("nixpi-ttyd", "start", undefined, ctx as never);
		expect(result.isError).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// handleScheduleReboot
// ---------------------------------------------------------------------------
describe("handleScheduleReboot", () => {
	it("schedules reboot with valid delay and returns success", async () => {
		mockRun.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });
		const ctx = createMockExtensionContext();
		const result = await handleScheduleReboot(10, undefined, ctx as never);
		expect(result.isError).toBeFalsy();
		expect(result.content[0].text).toContain("Reboot scheduled in 10 minute(s)");
	});

	it("clamps delay to minimum of 1 minute", async () => {
		mockRun.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });
		const ctx = createMockExtensionContext();
		const result = await handleScheduleReboot(0, undefined, ctx as never);
		expect(result.content[0].text).toContain("1 minute(s)");
	});

	it("clamps delay to maximum of 7 days (10080 minutes)", async () => {
		mockRun.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });
		const ctx = createMockExtensionContext();
		const result = await handleScheduleReboot(99999, undefined, ctx as never);
		expect(result.content[0].text).toContain("10080 minute(s)");
	});

	it("returns error when brokerctl fails", async () => {
		mockRun.mockResolvedValueOnce({ stdout: "", stderr: "permission denied", exitCode: 1 });
		const ctx = createMockExtensionContext();
		const result = await handleScheduleReboot(5, undefined, ctx as never);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Failed to schedule reboot");
	});

	it("returns error when user declines confirmation", async () => {
		const ctx = { hasUI: true, ui: { confirm: vi.fn().mockResolvedValue(false) } } as never;
		const result = await handleScheduleReboot(5, undefined, ctx);
		expect(result.isError).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// checkPendingUpdates
// ---------------------------------------------------------------------------
describe("checkPendingUpdates", () => {
	it("returns undefined when no status file exists", async () => {
		const result = await checkPendingUpdates("BASE PROMPT");
		expect(result).toBeUndefined();
	});

	it("injects update notice and marks notified when update is available and not yet notified", async () => {
		const stateDir = path.join(temp.nixPiDir, ".nixpi");
		fs.mkdirSync(stateDir, { recursive: true });
		const statusPath = path.join(stateDir, "update-status.json");
		fs.writeFileSync(
			statusPath,
			JSON.stringify({ available: true, notified: false, checked: "2025-06-01T00:00:00Z" }),
			"utf-8",
		);

		const result = await checkPendingUpdates("BASE PROMPT");
		expect(result).toBeDefined();
		expect(result?.systemPrompt).toContain("BASE PROMPT");
		expect(result?.systemPrompt).toContain("NixPI update is available");

		// Verify notified flag was set
		const updated = JSON.parse(fs.readFileSync(statusPath, "utf-8"));
		expect(updated.notified).toBe(true);
	});

	it("returns undefined when update is available but already notified", async () => {
		const stateDir = path.join(temp.nixPiDir, ".nixpi");
		fs.mkdirSync(stateDir, { recursive: true });
		fs.writeFileSync(
			path.join(stateDir, "update-status.json"),
			JSON.stringify({ available: true, notified: true, checked: "2025-06-01T00:00:00Z" }),
			"utf-8",
		);

		const result = await checkPendingUpdates("BASE PROMPT");
		expect(result).toBeUndefined();
	});

	it("returns undefined when no update is available", async () => {
		const stateDir = path.join(temp.nixPiDir, ".nixpi");
		fs.mkdirSync(stateDir, { recursive: true });
		fs.writeFileSync(
			path.join(stateDir, "update-status.json"),
			JSON.stringify({ available: false, checked: "2025-06-01T00:00:00Z" }),
			"utf-8",
		);

		const result = await checkPendingUpdates("BASE PROMPT");
		expect(result).toBeUndefined();
	});
});
