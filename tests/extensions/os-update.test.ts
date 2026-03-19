import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockExtensionContext } from "../helpers/mock-extension-context.js";

const runMock = vi.fn();

vi.mock("../../core/lib/exec.js", () => ({
	run: (...args: unknown[]) => runMock(...args),
}));

describe("os nixos_update handler", () => {
	let repoDir: string;
	const originalRepoDir = process.env.WORKSPACE_REPO_DIR;

	beforeEach(() => {
		vi.resetModules();
		runMock.mockReset();
		repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-switch-"));
		process.env.WORKSPACE_REPO_DIR = repoDir;
	});

	afterEach(() => {
		if (originalRepoDir === undefined) {
			delete process.env.WORKSPACE_REPO_DIR;
		} else {
			process.env.WORKSPACE_REPO_DIR = originalRepoDir;
		}
		fs.rmSync(repoDir, { recursive: true, force: true });
	});

	it("applies the remote flake by default", async () => {
		runMock.mockResolvedValueOnce({ stdout: "ok\n", stderr: "", exitCode: 0 });

		const { handleNixosUpdate } = await import("../../core/pi/extensions/os/actions.js");
		const ctx = createMockExtensionContext({ hasUI: true });
		const result = await handleNixosUpdate("apply", "remote", undefined, ctx as never);

		expect(ctx.ui.confirm).toHaveBeenCalled();
		expect(runMock).toHaveBeenCalledWith(
			"sudo",
			["nixos-rebuild", "switch", "--flake", "github:alexradunet/piBloom#desktop"],
			undefined,
		);
		expect(result.isError).toBe(false);
		expect(result.content[0].text).toContain("from remote source");
	});

	it("applies the reviewed local clone when source=local", async () => {
		runMock.mockResolvedValueOnce({ stdout: "ok\n", stderr: "", exitCode: 0 });

		const { handleNixosUpdate } = await import("../../core/pi/extensions/os/actions.js");
		const ctx = createMockExtensionContext({ hasUI: true });
		const result = await handleNixosUpdate("apply", "local", undefined, ctx as never);

		expect(runMock).toHaveBeenCalledWith(
			"sudo",
			["nixos-rebuild", "switch", "--flake", `${repoDir}#desktop`],
			undefined,
		);
		expect(result.isError).toBe(false);
		expect(result.content[0].text).toContain("from local source");
	});

	it("fails early if the local repo is missing", async () => {
		fs.rmSync(repoDir, { recursive: true, force: true });

		const { handleNixosUpdate } = await import("../../core/pi/extensions/os/actions.js");
		const ctx = createMockExtensionContext({ hasUI: true });
		const result = await handleNixosUpdate("apply", "local", undefined, ctx as never);

		expect(runMock).not.toHaveBeenCalled();
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Local nixPI repo not found");
	});

	it("returns error result when remote apply exits non-zero", async () => {
		runMock.mockResolvedValueOnce({ stdout: "", stderr: "build failed", exitCode: 1 });

		const { handleNixosUpdate } = await import("../../core/pi/extensions/os/actions.js");
		const ctx = createMockExtensionContext({ hasUI: true });
		const result = await handleNixosUpdate("apply", "remote", undefined, ctx as never);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("build failed");
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
