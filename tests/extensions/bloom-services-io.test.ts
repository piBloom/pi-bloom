import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runMock } = vi.hoisted(() => ({
	runMock: vi.fn(),
}));

vi.mock("../../core/lib/exec.js", () => ({
	run: runMock,
}));

import { installServicePackage } from "../../core/extensions/bloom-services/service-io.js";

describe("installServicePackage", () => {
	let tempHome: string;
	let tempRepo: string;
	let originalHome: string | undefined;

	beforeEach(() => {
		tempHome = mkdtempSync(join(os.tmpdir(), "bloom-service-io-home-"));
		tempRepo = mkdtempSync(join(os.tmpdir(), "bloom-service-io-repo-"));
		originalHome = process.env.HOME;
		process.env.HOME = tempHome;
		runMock.mockReset();
		runMock.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "" });
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

	it("writes Cinny runtime config preconfigured for the Bloom Matrix server", async () => {
		runMock.mockResolvedValue({
			exitCode: 0,
			stdout: JSON.stringify({
				fqdn: "bloom-164-14.netbird.cloud",
				netbirdIp: "100.109.164.14/16",
			}),
			stderr: "",
		});

		const serviceDir = join(tempRepo, "services", "cinny");
		const quadletDir = join(serviceDir, "quadlet");
		mkdirSync(quadletDir, { recursive: true });
		writeFileSync(join(serviceDir, "SKILL.md"), "# cinny\n");
		writeFileSync(join(quadletDir, "bloom-cinny.container"), "[Container]\nImage=test\n");

		const result = await installServicePackage("cinny", join(tempHome, "Bloom"), tempRepo);

		expect(result.ok).toBe(true);
		const cinnyConfig = JSON.parse(
			readFileSync(join(tempHome, ".config", "bloom", "cinny", "config.json"), "utf-8"),
		) as {
			defaultHomeserver: number;
			homeserverList: string[];
		};
		expect(cinnyConfig.defaultHomeserver).toBe(0);
		expect(cinnyConfig.homeserverList).toEqual([
			"http://bloom-164-14.netbird.cloud:6167",
			"http://100.109.164.14:6167",
		]);

		const wellKnown = JSON.parse(
			readFileSync(join(tempHome, ".config", "bloom", "cinny", ".well-known", "matrix", "client"), "utf-8"),
		) as {
			"m.homeserver": { base_url: string; server_name: string };
		};
		expect(wellKnown["m.homeserver"].base_url).toBe("http://bloom-164-14.netbird.cloud:6167");
		expect(wellKnown["m.homeserver"].server_name).toBe("bloom");

		const nginxConf = readFileSync(join(tempHome, ".config", "bloom", "cinny", "nginx.conf"), "utf-8");
		expect(nginxConf).toContain("location = /.well-known/matrix/client");
		expect(nginxConf).toContain("try_files /.well-known/matrix/client =404;");
	});
});
