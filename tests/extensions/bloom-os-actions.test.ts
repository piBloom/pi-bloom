import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockExtensionContext } from "../helpers/mock-extension-context.js";

const runMock = vi.fn();

vi.mock("../../core/lib/exec.js", () => ({
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
			process.env.HOME = undefined;
		} else {
			process.env.HOME = originalHome;
		}
		rmSync(tempHome, { recursive: true, force: true });
	});

	it("starts the socket unit when a matching user socket exists", async () => {
		const userSystemdDir = join(tempHome, ".config", "systemd", "user");
		mkdirSync(userSystemdDir, { recursive: true });
		writeFileSync(join(userSystemdDir, "bloom-code-server.socket"), "[Socket]\n");

		const { handleContainerDeploy } = await import("../../core/pi-extensions/bloom-os/actions.js");
		const ctx = createMockExtensionContext();
		const result = await handleContainerDeploy("bloom-code-server", undefined, ctx as never);

		expect(result.isError).toBe(false);
		expect(runMock).toHaveBeenNthCalledWith(1, "systemctl", ["--user", "daemon-reload"], undefined);
		expect(runMock).toHaveBeenNthCalledWith(2, "systemctl", ["--user", "start", "bloom-code-server.socket"], undefined);
		expect(result.content[0].text).toContain("Started bloom-code-server.socket successfully.");
	});

	it("requires and then consumes Matrix confirmation before deploy", async () => {
		const { handleContainerDeploy } = await import("../../core/pi-extensions/bloom-os/actions.js");
		const ctx = createMockExtensionContext({ hasUI: false });
		const sessionFile = join(tempHome, "session.jsonl");
		ctx.sessionManager.getSessionFile.mockReturnValue(sessionFile);
		ctx.sessionManager.getSessionDir.mockReturnValue(tempHome);
		ctx.sessionManager.getSessionId.mockReturnValue("session");

		const first = await handleContainerDeploy("bloom-code-server", undefined, ctx as never);

		expect(first.isError).toBe(true);
		expect(first.content[0]?.text).toContain('Confirmation required for "Deploy container bloom-code-server.service"');
		expect(runMock).not.toHaveBeenCalled();

		const pendingStore = JSON.parse(readFileSync(`${sessionFile}.bloom-interactions.json`, "utf-8")) as {
			records: Array<{ token: string; key: string; status: string; kind: string; resolution?: string }>;
		};
		expect(pendingStore.records).toHaveLength(1);
		expect(pendingStore.records[0]?.kind).toBe("confirm");
		expect(pendingStore.records[0]?.status).toBe("pending");

		pendingStore.records[0]!.status = "resolved";
		pendingStore.records[0]!.resolution = "approved";
		writeFileSync(`${sessionFile}.bloom-interactions.json`, JSON.stringify(pendingStore));

		const second = await handleContainerDeploy("bloom-code-server", undefined, ctx as never);

		expect(second.isError).toBe(false);
		expect(runMock).toHaveBeenNthCalledWith(1, "systemctl", ["--user", "daemon-reload"], undefined);
		expect(runMock).toHaveBeenNthCalledWith(2, "systemctl", ["--user", "start", "bloom-code-server.service"], undefined);
	});
});
