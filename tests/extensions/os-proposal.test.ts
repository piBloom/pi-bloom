import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockExtensionContext } from "../helpers/mock-extension-context.js";

const runMock = vi.fn();

vi.mock("../../core/lib/exec.js", () => ({
	run: (...args: unknown[]) => runMock(...args),
}));

describe("os local Nix proposal handler", () => {
	let repoDir: string;
	const originalRepoDir = process.env.WORKSPACE_REPO_DIR;

	beforeEach(() => {
		vi.resetModules();
		runMock.mockReset();
		repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-repo-"));
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

	it("reports git branch and working tree status for the local proposal repo", async () => {
		runMock
			.mockResolvedValueOnce({ stdout: "main\n", stderr: "", exitCode: 0 })
			.mockResolvedValueOnce({ stdout: " M flake.nix\n", stderr: "", exitCode: 0 })
			.mockResolvedValueOnce({ stdout: " flake.nix | 2 +-\n", stderr: "", exitCode: 0 });

		const { handleNixConfigProposal } = await import("../../core/pi/extensions/os/actions-proposal.js");
		const result = await handleNixConfigProposal("status", undefined, createMockExtensionContext() as never);

		expect(result.isError).toBeUndefined();
		expect(result.content[0].text).toContain(`Local proposal repo: ${repoDir}`);
		expect(result.content[0].text).toContain("Branch: main");
		expect(result.content[0].text).toContain("M flake.nix");
	});

	it("runs both flake and config validation in the local repo", async () => {
		runMock
			.mockResolvedValueOnce({ stdout: "flake ok\n", stderr: "", exitCode: 0 })
			.mockResolvedValueOnce({ stdout: "config ok\n", stderr: "", exitCode: 0 });

		const { handleNixConfigProposal } = await import("../../core/pi/extensions/os/actions-proposal.js");
		const result = await handleNixConfigProposal("validate", undefined, createMockExtensionContext() as never);

		expect(result.isError).toBe(false);
		expect(result.content[0].text).toContain("nix flake check --no-build: ok");
		expect(result.content[0].text).toContain("nix build .#checks.x86_64-linux.config --no-link: ok");
		expect(runMock).toHaveBeenNthCalledWith(1, "nix", ["flake", "check", "--no-build"], undefined, repoDir);
		expect(runMock).toHaveBeenNthCalledWith(
			2,
			"nix",
			["build", ".#checks.x86_64-linux.config", "--no-link"],
			undefined,
			repoDir,
		);
	});

	it("requires confirmation before refreshing flake.lock", async () => {
		runMock
			.mockResolvedValueOnce({ stdout: "updated inputs\n", stderr: "", exitCode: 0 })
			.mockResolvedValueOnce({ stdout: " M flake.lock\n", stderr: "", exitCode: 0 });

		const ctx = createMockExtensionContext({ hasUI: true });
		const { handleNixConfigProposal } = await import("../../core/pi/extensions/os/actions-proposal.js");
		const result = await handleNixConfigProposal("update_flake_lock", undefined, ctx as never);

		expect(ctx.ui.confirm).toHaveBeenCalled();
		expect(result.isError).toBe(false);
		expect(result.content[0].text).toContain("flake.lock status:");
		expect(result.content[0].text).toContain("M flake.lock");
	});

	it("returns an error when the local proposal repo is missing", async () => {
		fs.rmSync(repoDir, { recursive: true, force: true });

		const { handleNixConfigProposal } = await import("../../core/pi/extensions/os/actions-proposal.js");
		const result = await handleNixConfigProposal("status", undefined, createMockExtensionContext() as never);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Local nixPI repo not found");
	});

	it("returns isError when validate fails", async () => {
		runMock
			.mockResolvedValueOnce({ stdout: "", stderr: "flake error", exitCode: 1 })
			.mockResolvedValueOnce({ stdout: "", stderr: "build error", exitCode: 1 });

		const { handleNixConfigProposal } = await import("../../core/pi/extensions/os/actions-proposal.js");
		const result = await handleNixConfigProposal("validate", undefined, createMockExtensionContext() as never);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("failed");
	});

	it("returns isError when update_flake_lock command fails", async () => {
		runMock.mockResolvedValueOnce({ stdout: "", stderr: "network error", exitCode: 1 });

		const ctx = createMockExtensionContext({ hasUI: true });
		const { handleNixConfigProposal } = await import("../../core/pi/extensions/os/actions-proposal.js");
		const result = await handleNixConfigProposal("update_flake_lock", undefined, ctx as never);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("nix flake update failed");
	});
});
