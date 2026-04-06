import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockExtensionContext } from "../helpers/mock-extension-context.js";
import { createTempNixPi, type TempNixPi } from "../helpers/temp-nixpi.js";

const runMock = vi.fn();

let temp: TempNixPi;
let originalSystemFlakeDir: string | undefined;

vi.mock("../../core/lib/exec.js", () => ({
	run: (...args: unknown[]) => runMock(...args),
}));

describe("os nixos_update handler", () => {
	beforeEach(() => {
		vi.resetModules();
		runMock.mockReset();
		temp = createTempNixPi();
		originalSystemFlakeDir = process.env.NIXPI_SYSTEM_FLAKE_DIR;
		delete process.env.NIXPI_SYSTEM_FLAKE_DIR;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		temp.cleanup();
		if (originalSystemFlakeDir !== undefined) {
			process.env.NIXPI_SYSTEM_FLAKE_DIR = originalSystemFlakeDir;
		} else {
			delete process.env.NIXPI_SYSTEM_FLAKE_DIR;
		}
	});

	it("applies the canonical /etc/nixos flake checkout", async () => {
		vi.spyOn(fs, "existsSync").mockReturnValue(true);
		runMock.mockResolvedValueOnce({ stdout: "main\n", stderr: "", exitCode: 0 });
		runMock.mockResolvedValueOnce({ stdout: "ok\n", stderr: "", exitCode: 0 });

		const { handleNixosUpdate } = await import("../../core/pi/extensions/os/actions.js");
		const ctx = createMockExtensionContext({ hasUI: true });
		const result = await handleNixosUpdate("apply", undefined, ctx as never);
		const expectedFlake = "/etc/nixos";

		expect(ctx.ui.confirm).toHaveBeenCalled();
		expect(runMock).toHaveBeenNthCalledWith(1, "git", ["-C", "/srv/nixpi", "branch", "--show-current"], undefined);
		expect(runMock).toHaveBeenNthCalledWith(2, "nixpi-brokerctl", ["nixos-update", "apply", expectedFlake], undefined);
		expect(result.isError).toBe(false);
		expect(result.content[0].text).toContain(`from ${expectedFlake}`);
	});

	it("uses NIXPI_SYSTEM_FLAKE_DIR when explicitly set", async () => {
		const explicitFlakeDir = path.join(temp.nixPiDir, "system-flake");
		process.env.NIXPI_SYSTEM_FLAKE_DIR = explicitFlakeDir;
		vi.spyOn(fs, "existsSync").mockReturnValue(true);
		runMock.mockResolvedValueOnce({ stdout: "main\n", stderr: "", exitCode: 0 });
		runMock.mockResolvedValueOnce({ stdout: "ok\n", stderr: "", exitCode: 0 });

		const { handleNixosUpdate } = await import("../../core/pi/extensions/os/actions.js");
		const ctx = createMockExtensionContext({ hasUI: true });
		await handleNixosUpdate("apply", undefined, ctx as never);

		expect(runMock).toHaveBeenNthCalledWith(1, "git", ["-C", "/srv/nixpi", "branch", "--show-current"], undefined);
		expect(runMock).toHaveBeenNthCalledWith(
			2,
			"nixpi-brokerctl",
			["nixos-update", "apply", explicitFlakeDir],
			undefined,
		);
	});

	it("fails early if the canonical system flake is missing", async () => {
		vi.spyOn(fs, "existsSync").mockReturnValue(false);

		const { handleNixosUpdate } = await import("../../core/pi/extensions/os/actions.js");
		const ctx = createMockExtensionContext({ hasUI: true });
		const result = await handleNixosUpdate("apply", undefined, ctx as never);

		expect(runMock).not.toHaveBeenCalled();
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("System flake not found at /etc/nixos");
		expect(result.content[0].text).toContain("host-owned flake");
		expect(result.content[0].text).toContain("/srv/nixpi");
		expect(result.content[0].text).toContain("bootstrap");
	});

	it("returns error result when apply exits non-zero", async () => {
		vi.spyOn(fs, "existsSync").mockReturnValue(true);
		runMock.mockResolvedValueOnce({ stdout: "main\n", stderr: "", exitCode: 0 });
		runMock.mockResolvedValueOnce({ stdout: "", stderr: "build failed", exitCode: 1 });

		const { handleNixosUpdate } = await import("../../core/pi/extensions/os/actions.js");
		const ctx = createMockExtensionContext({ hasUI: true });
		const result = await handleNixosUpdate("apply", undefined, ctx as never);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("build failed");
	});

	it("rejects apply when /srv/nixpi is not on main", async () => {
		vi.spyOn(fs, "existsSync").mockReturnValue(true);
		runMock.mockResolvedValueOnce({ stdout: "feature/test\n", stderr: "", exitCode: 0 });

		const { handleNixosUpdate } = await import("../../core/pi/extensions/os/actions.js");
		const ctx = createMockExtensionContext({ hasUI: true });
		const result = await handleNixosUpdate("apply", undefined, ctx as never);

		expect(runMock).toHaveBeenCalledWith("git", ["-C", "/srv/nixpi", "branch", "--show-current"], undefined);
		expect(runMock).not.toHaveBeenCalledWith("nixpi-brokerctl", ["nixos-update", "apply", "/etc/nixos"], undefined);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Supported rebuilds require /srv/nixpi to be on main");
		expect(result.content[0].text).toContain("switch to main");
	});

	it("schedules a reboot after confirmation", async () => {
		runMock.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

		const { handleScheduleReboot } = await import("../../core/pi/extensions/os/actions.js");
		const ctx = createMockExtensionContext({ hasUI: true });
		const result = await handleScheduleReboot(5, undefined, ctx as never);

		expect(ctx.ui.confirm).toHaveBeenCalled();
		expect((result as { isError?: boolean }).isError).toBeFalsy();
		expect(result.content[0].text).toContain("5 minute");
	});

	it("returns error when schedule reboot command fails", async () => {
		runMock.mockResolvedValueOnce({ stdout: "", stderr: "permission denied", exitCode: 1 });

		const { handleScheduleReboot } = await import("../../core/pi/extensions/os/actions.js");
		const ctx = createMockExtensionContext({ hasUI: true });
		const result = await handleScheduleReboot(1, undefined, ctx as never);

		expect((result as { isError?: boolean }).isError).toBe(true);
		expect(result.content[0].text).toContain("Failed to schedule reboot");
	});
});
