import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockExtensionAPI } from "../helpers/mock-extension-api.js";
import { createMockExtensionContext } from "../helpers/mock-extension-context.js";
import { createTempNixPi, type TempNixPi } from "../helpers/temp-nixpi.js";

let temp: TempNixPi;

beforeEach(() => {
	temp = createTempNixPi();
});

afterEach(() => {
	temp.cleanup();
});

// We test NixPI seeding by importing and calling the nixpi extension
// which calls ensureNixPi + seedBlueprints in its session_start handler.
async function runNixpiExtension() {
	const mod = await import("../../core/pi/extensions/nixpi/index.js");
	const api = createMockExtensionAPI();
	const ctx = createMockExtensionContext();
	mod.default(api as never);
	await api.fireEvent("session_start", {}, ctx);
	return { api, ctx };
}

describe("nixpi seeding", () => {
	it("creates NixPI subdirectories", async () => {
		await runNixpiExtension();

		const expected = ["Persona", "Skills", "Evolutions", "audit"];
		for (const dir of expected) {
			expect(existsSync(join(temp.nixPiDir, dir))).toBe(true);
		}
	});

	it("creates blueprint-versions.json", async () => {
		await runNixpiExtension();

		const versionsPath = join(temp.nixPiDir, "blueprint-versions.json");
		expect(existsSync(versionsPath)).toBe(true);

		const versions = JSON.parse(readFileSync(versionsPath, "utf-8"));
		expect(versions).toHaveProperty("packageVersion");
		expect(versions).toHaveProperty("seeded");
		expect(versions).toHaveProperty("seededHashes");
	});

	it("second call is idempotent", async () => {
		await runNixpiExtension();
		const versionsPath = join(temp.nixPiDir, "blueprint-versions.json");
		const first = readFileSync(versionsPath, "utf-8");

		await runNixpiExtension();
		const second = readFileSync(versionsPath, "utf-8");

		expect(JSON.parse(first)).toEqual(JSON.parse(second));
	});

	it("tracks updates available when user modifies seeded file", async () => {
		await runNixpiExtension();

		// Modify a seeded persona file
		const soulPath = join(temp.nixPiDir, "Persona", "SOUL.md");
		if (existsSync(soulPath)) {
			writeFileSync(soulPath, "user modified content");

			// Re-run to trigger update detection
			await runNixpiExtension();

			const versionsPath = join(temp.nixPiDir, "blueprint-versions.json");
			const versions = JSON.parse(readFileSync(versionsPath, "utf-8"));
			// updatesAvailable may have the modified key
			expect(versions).toHaveProperty("updatesAvailable");
		}
	});

	it("sets _NIXPI_DIR_RESOLVED env var", async () => {
		await runNixpiExtension();
		expect(process.env._NIXPI_DIR_RESOLVED).toBe(temp.nixPiDir);
	});

	it("sets UI status when hasUI is true", async () => {
		const { ctx } = await runNixpiExtension();
		expect(ctx.ui.setStatus).toHaveBeenCalledWith("nixpi", expect.stringContaining("NixPI:"));
	});
});
