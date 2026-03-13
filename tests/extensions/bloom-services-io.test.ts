import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installServicePackage } from "../../extensions/bloom-services/service-io.js";

describe("installServicePackage", () => {
	let tempHome: string;
	let tempRepo: string;
	let originalHome: string | undefined;

	beforeEach(() => {
		tempHome = mkdtempSync(join(os.tmpdir(), "bloom-service-io-home-"));
		tempRepo = mkdtempSync(join(os.tmpdir(), "bloom-service-io-repo-"));
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
		rmSync(tempRepo, { recursive: true, force: true });
	});

	it("creates the dedicated Bloom share directory when installing dufs", async () => {
		const serviceDir = join(tempRepo, "services", "dufs");
		const quadletDir = join(serviceDir, "quadlet");
		mkdirSync(quadletDir, { recursive: true });
		writeFileSync(join(serviceDir, "SKILL.md"), "# dufs\n");
		writeFileSync(join(quadletDir, "bloom-dufs.container"), "[Container]\nImage=test\n");

		const result = await installServicePackage("dufs", join(tempHome, "Bloom"), tempRepo);

		expect(result.ok).toBe(true);
		expect(existsSync(join(tempHome, "Public", "Bloom"))).toBe(true);
	});
});
