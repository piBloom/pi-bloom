import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockExtensionAPI } from "../helpers/mock-extension-api.js";
import { createMockExtensionContext } from "../helpers/mock-extension-context.js";
import { createTempWorkspace, type TempWorkspace } from "../helpers/temp-workspace.js";

let temp: TempWorkspace;

beforeEach(() => {
	temp = createTempWorkspace();
});

afterEach(() => {
	temp.cleanup();
});

// We test workspace seeding by importing and calling the workspace extension
// which calls ensureWorkspace + seedBlueprints in its session_start handler.
async function runGardenExtension() {
	const mod = await import("../../core/pi/extensions/workspace/index.js");
	const api = createMockExtensionAPI();
	const ctx = createMockExtensionContext();
	mod.default(api as never);
	await api.fireEvent("session_start", {}, ctx);
	return { api, ctx };
}

describe("workspace seeding", () => {
	it("creates Workspace subdirectories", async () => {
		await runGardenExtension();

		const expected = ["Persona", "Skills", "Evolutions", "audit"];
		for (const dir of expected) {
			expect(existsSync(join(temp.workspaceDir, dir))).toBe(true);
		}
	});

	it("creates blueprint-versions.json", async () => {
		await runGardenExtension();

		const versionsPath = join(temp.workspaceDir, "blueprint-versions.json");
		expect(existsSync(versionsPath)).toBe(true);

		const versions = JSON.parse(readFileSync(versionsPath, "utf-8"));
		expect(versions).toHaveProperty("packageVersion");
		expect(versions).toHaveProperty("seeded");
		expect(versions).toHaveProperty("seededHashes");
	});

	it("second call is idempotent", async () => {
		await runGardenExtension();
		const versionsPath = join(temp.workspaceDir, "blueprint-versions.json");
		const first = readFileSync(versionsPath, "utf-8");

		await runGardenExtension();
		const second = readFileSync(versionsPath, "utf-8");

		expect(JSON.parse(first)).toEqual(JSON.parse(second));
	});

	it("tracks updates available when user modifies seeded file", async () => {
		await runGardenExtension();

		// Modify a seeded persona file
		const soulPath = join(temp.workspaceDir, "Persona", "SOUL.md");
		if (existsSync(soulPath)) {
			writeFileSync(soulPath, "user modified content");

			// Re-run to trigger update detection
			await runGardenExtension();

			const versionsPath = join(temp.workspaceDir, "blueprint-versions.json");
			const versions = JSON.parse(readFileSync(versionsPath, "utf-8"));
			// updatesAvailable may have the modified key
			expect(versions).toHaveProperty("updatesAvailable");
		}
	});

	it("does not create .stignore inside workspace dir", async () => {
		await runGardenExtension();
		expect(existsSync(join(temp.workspaceDir, ".stignore"))).toBe(false);
	});

	it("sets _WORKSPACE_DIR_RESOLVED env var", async () => {
		await runGardenExtension();
		expect(process.env._WORKSPACE_DIR_RESOLVED).toBe(temp.workspaceDir);
	});

	it("sets UI status when hasUI is true", async () => {
		const { ctx } = await runGardenExtension();
		expect(ctx.ui.setStatus).toHaveBeenCalledWith("workspace", expect.stringContaining("Workspace:"));
	});
});
