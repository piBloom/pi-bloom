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
	checkBootstrapDisable,
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

	it("describes the repo workflow as local-first and Git-backed", () => {
		const repoTool = api._registeredTools.find((tool) => tool.name === "nix_config_proposal");
		expect(repoTool?.description).toContain("local NixPI repository");
		expect(repoTool?.description).toContain("push");
		expect(repoTool?.description).toContain("apply");
		expect(JSON.stringify(repoTool?.parameters)).toContain("commit");
		expect(JSON.stringify(repoTool?.parameters)).toContain("push");
		expect(JSON.stringify(repoTool?.parameters)).toContain("apply");
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
		expect(result._unsafeUnwrap().text).toContain("gen1");
		expect(result._unsafeUnwrap().details).toEqual({ exitCode: 0 });
	});

	it("returns stderr on non-zero exit", async () => {
		mockRun.mockResolvedValueOnce({ stdout: "", stderr: "permission denied", exitCode: 1 });
		const result = await handleNixosUpdate("status", undefined, {} as never);
		expect(result._unsafeUnwrap().text).toContain("permission denied");
	});
});

describe("handleNixosUpdate — rollback", () => {
	it("returns success message on exit 0", async () => {
		const ctx = createMockExtensionContext();
		mockRun.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });
		const result = await handleNixosUpdate("rollback", undefined, ctx as never);
		expect(result._unsafeUnwrap().text).toContain("Rolled back");
	});
});

describe("handleNixosUpdate — apply (missing system flake)", () => {
	it("returns error when /etc/nixos/flake.nix is absent and keeps /srv/nixpi optional", async () => {
		vi.spyOn(fs, "existsSync").mockReturnValue(false);
		const ctx = createMockExtensionContext();
		const result = await handleNixosUpdate("apply", undefined, ctx as never);
		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toContain("System flake not found at /etc/nixos");
		expect(result._unsafeUnwrapErr()).toContain("installed host flake");
		expect(result._unsafeUnwrapErr()).toContain("operator checkout");
		expect(result._unsafeUnwrapErr()).toContain("optional");
	});
});

describe("handleSystemdControl", () => {
	it("rejects non-nixpi services", async () => {
		const ctx = createMockExtensionContext();
		const result = await handleSystemdControl("sshd", "status", undefined, ctx as never);
		expect(result.isErr()).toBe(true);
	});

	it("runs systemctl for nixpi-update status", async () => {
		mockRun.mockResolvedValueOnce({ stdout: "active", stderr: "", exitCode: 0 });
		const ctx = createMockExtensionContext();
		const result = await handleSystemdControl("nixpi-update", "status", undefined, ctx as never);
		expect(result._unsafeUnwrap().text).toContain("active");
		expect(result._unsafeUnwrap().details).toEqual({ exitCode: 0 });
	});
});

describe("handleUpdateStatus", () => {
	it("returns a defined text result (file absent case)", async () => {
		const result = await handleUpdateStatus();
		expect(result._unsafeUnwrapErr()).toBeDefined();
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
		expect(result._unsafeUnwrap().text).toContain("## OS");
		expect(result._unsafeUnwrap().text).toContain("gen1 (current)");
		expect(result._unsafeUnwrap().details).toMatchObject({
			sections: expect.arrayContaining(["## OS\nNixOS — gen1 (current)"]),
		});
	});

	it("returns text content even when all commands fail", async () => {
		mockRun.mockResolvedValue({ stdout: "", stderr: "error", exitCode: 1 });
		const result = await handleSystemHealth(undefined);
		expect(result._unsafeUnwrap().text).toContain("## OS");
		expect(result._unsafeUnwrap().text).toContain("nixos-rebuild unavailable");
	});

	it("includes container info when podman returns containers", async () => {
		mockRun
			.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 1 }) // nixos-rebuild fails
			.mockResolvedValueOnce({
				stdout: JSON.stringify([{ Names: ["nixpi-runtime"], Status: "Up 1 hour" }]),
				stderr: "",
				exitCode: 0,
			}) // podman ps
			.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 1 }) // df
			.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 1 }) // loadavg
			.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 1 }) // free
			.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 1 }); // uptime
		const result = await handleSystemHealth(undefined);
		expect(result._unsafeUnwrap().text).toContain("nixpi-runtime");
		expect(result._unsafeUnwrap().text).toContain("Up 1 hour");
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
		expect(result._unsafeUnwrap().text).toContain("parse error");
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
		expect(result._unsafeUnwrap().text).toContain("gen1 (current)");
		expect(result._unsafeUnwrap().text).toContain("## OS");
	});
});

// ---------------------------------------------------------------------------
// handleNixosUpdate — apply (success path)
// ---------------------------------------------------------------------------
describe("handleNixosUpdate — apply (success)", () => {
	it("returns success message when brokerctl apply succeeds without consulting /srv/nixpi", async () => {
		vi.spyOn(fs, "existsSync").mockReturnValue(true);
		mockRun.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }); // brokerctl apply
		const ctx = createMockExtensionContext();
		const result = await handleNixosUpdate("apply", undefined, ctx as never);
		expect(result.isErr()).toBe(false);
		expect(result._unsafeUnwrap().text).toContain("Update applied successfully");
		expect(result._unsafeUnwrap().details).toEqual({
			exitCode: 0,
			flake: "/etc/nixos#nixos",
			flakeDir: "/etc/nixos",
		});
		expect(mockRun).toHaveBeenCalledTimes(1);
		expect(mockRun).toHaveBeenCalledWith("nixpi-brokerctl", ["nixos-update", "apply", "/etc/nixos#nixos"], undefined);
	});

	it("returns error message when brokerctl apply fails", async () => {
		vi.spyOn(fs, "existsSync").mockReturnValue(true);
		mockRun.mockResolvedValueOnce({ stdout: "", stderr: "build failed", exitCode: 1 }); // brokerctl apply
		const ctx = createMockExtensionContext();
		const result = await handleNixosUpdate("apply", undefined, ctx as never);
		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toContain("build failed");
	});
});

// ---------------------------------------------------------------------------
// handleNixosUpdate — confirmation denial
// ---------------------------------------------------------------------------
describe("handleNixosUpdate — confirmation denial", () => {
	it("returns error when user declines rollback confirmation", async () => {
		const ctx = { hasUI: true, ui: { confirm: vi.fn().mockResolvedValue(false) } } as never;
		const result = await handleNixosUpdate("rollback", undefined, ctx);
		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toContain("declined");
	});
});

// ---------------------------------------------------------------------------
// handleSystemdControl — start / stop / restart
// ---------------------------------------------------------------------------
describe("handleSystemdControl — mutating actions", () => {
	it("runs start action on a valid nixpi service", async () => {
		mockRun.mockResolvedValueOnce({ stdout: "started", stderr: "", exitCode: 0 });
		const ctx = createMockExtensionContext();
		const result = await handleSystemdControl("nixpi-update", "start", undefined, ctx as never);
		expect(result.isErr()).toBe(false);
		expect(result._unsafeUnwrap().text).toContain("started");
	});

	it("runs stop action on a valid nixpi service", async () => {
		mockRun.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });
		const ctx = createMockExtensionContext();
		const result = await handleSystemdControl("nixpi-update", "stop", undefined, ctx as never);
		expect(result.isErr()).toBe(false);
	});

	it("runs restart action on a valid nixpi service", async () => {
		mockRun.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });
		const ctx = createMockExtensionContext();
		const result = await handleSystemdControl("nixpi-update", "restart", undefined, ctx as never);
		expect(result.isErr()).toBe(false);
	});

	it("returns error when user declines start confirmation", async () => {
		const ctx = { hasUI: true, ui: { confirm: vi.fn().mockResolvedValue(false) } } as never;
		const result = await handleSystemdControl("nixpi-update", "start", undefined, ctx);
		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toContain("declined");
	});

	it("returns error on non-zero exit code", async () => {
		mockRun.mockResolvedValueOnce({ stdout: "", stderr: "unit not found", exitCode: 5 });
		const ctx = createMockExtensionContext();
		const result = await handleSystemdControl("nixpi-update", "start", undefined, ctx as never);
		expect(result.isErr()).toBe(true);
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
		expect(result.isErr()).toBe(false);
		expect(result._unsafeUnwrap().text).toContain("Reboot scheduled in 10 minute(s)");
		expect(result._unsafeUnwrap().details).toEqual({ delay_minutes: 10 });
	});

	it("clamps delay to minimum of 1 minute", async () => {
		mockRun.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });
		const ctx = createMockExtensionContext();
		const result = await handleScheduleReboot(0, undefined, ctx as never);
		expect(result._unsafeUnwrap().text).toContain("1 minute(s)");
	});

	it("clamps delay to maximum of 7 days (10080 minutes)", async () => {
		mockRun.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });
		const ctx = createMockExtensionContext();
		const result = await handleScheduleReboot(99999, undefined, ctx as never);
		expect(result._unsafeUnwrap().text).toContain("10080 minute(s)");
	});

	it("returns error when brokerctl fails", async () => {
		mockRun.mockResolvedValueOnce({ stdout: "", stderr: "permission denied", exitCode: 1 });
		const ctx = createMockExtensionContext();
		const result = await handleScheduleReboot(5, undefined, ctx as never);
		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toContain("Failed to schedule reboot");
	});

	it("returns error when user declines confirmation", async () => {
		const ctx = { hasUI: true, ui: { confirm: vi.fn().mockResolvedValue(false) } } as never;
		const result = await handleScheduleReboot(5, undefined, ctx);
		expect(result.isErr()).toBe(true);
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

// ---------------------------------------------------------------------------
// checkBootstrapDisable
// ---------------------------------------------------------------------------

const SAFE_CONTENT = `{
  nixpi.bootstrap.enable = false;
  services.openssh.enable = true;
  nixpi.security.ssh.allowedSourceCIDRs = [ "1.2.3.4/32" ];
}`;

const SAFE_CONTENT_BOOTSTRAP_SSH = `{
  nixpi.bootstrap.enable = false;
  nixpi.bootstrap.ssh.enable = true;
  nixpi.security.ssh.allowedSourceCIDRs = [ "1.2.3.4/32" ];
}`;

const SAFE_DEFAULT_STEADY_SSH = `{
  nixpi.bootstrap.enable = false;
  nixpi.security.ssh.allowedSourceCIDRs = [ "1.2.3.4/32" ];
}`;

const SAFE_TRUSTED_INTERFACE_SSH = `{
  nixpi.bootstrap.enable = false;
  services.openssh.enable = true;
  networking.firewall.interfaces.wg0.allowedTCPPorts = [ 22 ];
}`;

const UNSAFE_EXPLICIT_SSH_DISABLED = `{
  nixpi.bootstrap.enable = false;
  nixpi.bootstrap.ssh.enable = false;
  nixpi.security.ssh.allowedSourceCIDRs = [ "1.2.3.4/32" ];
}`;

const UNSAFE_NO_CIDRS = `{
  nixpi.bootstrap.enable = false;
  services.openssh.enable = true;
  nixpi.security.ssh.allowedSourceCIDRs = [  ];
}`;

const UNSAFE_BOTH_MISSING = `{
  nixpi.bootstrap.enable = false;
}`;

const CONTENT_BOOTSTRAP_STILL_ENABLED = `{
  nixpi.bootstrap.enable = true;
}`;

describe("checkBootstrapDisable", () => {
	it("returns undefined for files outside /etc/nixos or not named nixpi-host.nix", () => {
		expect(checkBootstrapDisable("/home/alex/other.nix", UNSAFE_BOTH_MISSING)).toBeUndefined();
	});

	it("returns undefined when bootstrap is not being disabled", () => {
		expect(checkBootstrapDisable("/etc/nixos/nixpi-host.nix", CONTENT_BOOTSTRAP_STILL_ENABLED)).toBeUndefined();
	});

	it("returns undefined when both SSH and CIDRs are present (services.openssh)", () => {
		expect(checkBootstrapDisable("/etc/nixos/nixpi-host.nix", SAFE_CONTENT)).toBeUndefined();
	});

	it("returns undefined when both SSH and CIDRs are present (bootstrap.ssh.enable)", () => {
		expect(checkBootstrapDisable("/etc/nixos/nixpi-host.nix", SAFE_CONTENT_BOOTSTRAP_SSH)).toBeUndefined();
	});

	it("returns undefined for nixpi-host.nix matched by filename anywhere in path", () => {
		expect(checkBootstrapDisable("/srv/checkout/nixpi-host.nix", SAFE_CONTENT)).toBeUndefined();
	});

	it("returns undefined when SSH uses the steady-state default", () => {
		expect(checkBootstrapDisable("/etc/nixos/nixpi-host.nix", SAFE_DEFAULT_STEADY_SSH)).toBeUndefined();
	});

	it("returns undefined when SSH is kept reachable through a trusted interface rule", () => {
		expect(checkBootstrapDisable("/etc/nixos/nixpi-host.nix", SAFE_TRUSTED_INTERFACE_SSH)).toBeUndefined();
	});

	it("blocks when SSH is explicitly disabled", () => {
		const result = checkBootstrapDisable("/etc/nixos/nixpi-host.nix", UNSAFE_EXPLICIT_SSH_DISABLED);
		expect(result).toBeDefined();
		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("services.openssh.enable = true");
		expect(result?.reason).not.toContain("allowedSourceCIDRs");
	});

	it("blocks when neither CIDRs nor a trusted-interface rule are present", () => {
		const result = checkBootstrapDisable("/etc/nixos/nixpi-host.nix", UNSAFE_NO_CIDRS);
		expect(result).toBeDefined();
		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("allowedSourceCIDRs");
		expect(result?.reason).toContain("networking.firewall.interfaces.wg0.allowedTCPPorts");
		expect(result?.reason).not.toContain("services.openssh.enable");
	});

	it("blocks and suggests a reachability path when SSH uses the steady-state default", () => {
		const result = checkBootstrapDisable("/etc/nixos/nixpi-host.nix", UNSAFE_BOTH_MISSING);
		expect(result).toBeDefined();
		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("allowedSourceCIDRs");
		expect(result?.reason).toContain("networking.firewall.interfaces.wg0.allowedTCPPorts");
		expect(result?.reason).not.toContain("services.openssh.enable = true");
	});

	it("matches /etc/nixos/ subdirectory files that are directly under /etc/nixos/", () => {
		const result = checkBootstrapDisable("/etc/nixos/custom.nix", UNSAFE_BOTH_MISSING);
		expect(result).toBeDefined();
		expect(result?.block).toBe(true);
	});

	it("does not match .nix files in subdirectories of /etc/nixos/", () => {
		expect(checkBootstrapDisable("/etc/nixos/sub/deep.nix", UNSAFE_BOTH_MISSING)).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// tool_call hook — bootstrap disable guard
// ---------------------------------------------------------------------------

describe("tool_call hook — write to nixpi-host.nix", () => {
	it("blocks write with bootstrap.enable = false and no SSH/CIDRs", async () => {
		const result = await api.fireEvent("tool_call", {
			type: "tool_call",
			toolCallId: "tc-1",
			toolName: "write",
			input: { path: "/etc/nixos/nixpi-host.nix", content: UNSAFE_BOTH_MISSING },
		});
		expect((result as { block: boolean }).block).toBe(true);
		expect((result as { reason: string }).reason).toContain("Disabling bootstrap");
	});

	it("allows write with bootstrap.enable = false when SSH and CIDRs are present", async () => {
		const result = await api.fireEvent("tool_call", {
			type: "tool_call",
			toolCallId: "tc-2",
			toolName: "write",
			input: { path: "/etc/nixos/nixpi-host.nix", content: SAFE_CONTENT },
		});
		expect(result).toBeUndefined();
	});

	it("allows write with bootstrap.enable = false when SSH is restricted to a trusted interface", async () => {
		const result = await api.fireEvent("tool_call", {
			type: "tool_call",
			toolCallId: "tc-2b",
			toolName: "write",
			input: { path: "/etc/nixos/nixpi-host.nix", content: SAFE_TRUSTED_INTERFACE_SSH },
		});
		expect(result).toBeUndefined();
	});

	it("allows write to unrelated .nix files", async () => {
		const result = await api.fireEvent("tool_call", {
			type: "tool_call",
			toolCallId: "tc-3",
			toolName: "write",
			input: { path: "/etc/nixos/subdir/deep.nix", content: UNSAFE_BOTH_MISSING },
		});
		expect(result).toBeUndefined();
	});
});

describe("tool_call hook — edit to nixpi-host.nix", () => {
	it("blocks edit that introduces bootstrap.enable = false without SSH/CIDRs", async () => {
		const hostFile = path.join(temp.nixPiDir, "nixpi-host.nix");
		fs.writeFileSync(hostFile, "{ nixpi.bootstrap.enable = true; }", "utf-8");

		const result = await api.fireEvent("tool_call", {
			type: "tool_call",
			toolCallId: "tc-4",
			toolName: "edit",
			input: {
				path: hostFile,
				oldText: "nixpi.bootstrap.enable = true;",
				newText: "nixpi.bootstrap.enable = false;",
			},
		});
		expect((result as { block: boolean }).block).toBe(true);
		expect((result as { reason: string }).reason).toContain("Disabling bootstrap");
	});

	it("allows edit that introduces bootstrap.enable = false with SSH and CIDRs present", async () => {
		const hostFile = path.join(temp.nixPiDir, "nixpi-host.nix");
		fs.writeFileSync(
			hostFile,
			`{
        nixpi.bootstrap.enable = true;
        services.openssh.enable = true;
        nixpi.security.ssh.allowedSourceCIDRs = [ "1.2.3.4/32" ];
      }`,
			"utf-8",
		);

		const result = await api.fireEvent("tool_call", {
			type: "tool_call",
			toolCallId: "tc-5",
			toolName: "edit",
			input: {
				path: hostFile,
				oldText: "nixpi.bootstrap.enable = true;",
				newText: "nixpi.bootstrap.enable = false;",
			},
		});
		expect(result).toBeUndefined();
	});

	it("allows edit that introduces bootstrap.enable = false with trusted-interface-only SSH", async () => {
		const hostFile = path.join(temp.nixPiDir, "nixpi-host.nix");
		fs.writeFileSync(
			hostFile,
			`{
        nixpi.bootstrap.enable = true;
        services.openssh.enable = true;
        networking.firewall.interfaces.wg0.allowedTCPPorts = [ 22 ];
      }`,
			"utf-8",
		);

		const result = await api.fireEvent("tool_call", {
			type: "tool_call",
			toolCallId: "tc-5b",
			toolName: "edit",
			input: {
				path: hostFile,
				oldText: "nixpi.bootstrap.enable = true;",
				newText: "nixpi.bootstrap.enable = false;",
			},
		});
		expect(result).toBeUndefined();
	});

	it("returns undefined when edit target file does not exist", async () => {
		const missingPath = path.join(temp.nixPiDir, "does-not-exist.nix");
		const result = await api.fireEvent("tool_call", {
			type: "tool_call",
			toolCallId: "tc-6",
			toolName: "edit",
			input: {
				path: missingPath,
				oldText: "nixpi.bootstrap.enable = true;",
				newText: "nixpi.bootstrap.enable = false;",
			},
		});
		expect(result).toBeUndefined();
	});
});
