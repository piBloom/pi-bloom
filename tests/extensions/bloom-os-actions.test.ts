import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockExtensionContext } from "../helpers/mock-extension-context.js";

const runMock = vi.fn();

vi.mock("../../lib/exec.js", () => ({
	run: runMock,
}));

describe("handleContainerDeploy", () => {
	let tempHome: string;
	let originalHome: string | undefined;

	beforeEach(() => {
		runMock.mockReset();
		runMock.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
		tempHome = mkdtempSync(join(os.tmpdir(), "bloom-os-actions-"));
		originalHome = process.env.HOME;
		process.env.HOME = tempHome;
	});

	afterEach(() => {
		if (originalHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = originalHome;
		}
		rmSync(tempHome, { recursive: true, force: true });
	});

	it("starts the socket unit when a matching user socket exists", async () => {
		const userSystemdDir = join(tempHome, ".config", "systemd", "user");
		mkdirSync(userSystemdDir, { recursive: true });
		writeFileSync(join(userSystemdDir, "bloom-code-server.socket"), "[Socket]\n");

		const { handleContainerDeploy } = await import("../../extensions/bloom-os/actions.js");
		const ctx = createMockExtensionContext();
		const result = await handleContainerDeploy("bloom-code-server", undefined, ctx as never);

		expect(result.isError).toBe(false);
		expect(runMock).toHaveBeenNthCalledWith(
			1,
			"systemctl",
			["--user", "daemon-reload"],
			undefined,
		);
		expect(runMock).toHaveBeenNthCalledWith(
			2,
			"systemctl",
			["--user", "start", "bloom-code-server.socket"],
			undefined,
		);
		expect(result.content[0].text).toContain("Started bloom-code-server.socket successfully.");
	});
});
