import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appModulePath, packageJsonPath, piPackagePath, readUtf8, repoRoot } from "./standards-guard.shared.js";

describe("repo standards tooling guards", () => {
	it("configures VitePress for GitHub Project Pages", () => {
		const vitePressConfig = readUtf8(path.join(repoRoot, "docs/.vitepress/config.ts"));
		expect(vitePressConfig).toContain('base: "/NixPI/"');
	});

	it("declares compatible Pi peer dependency ranges and CI checks", () => {
		const packageJson = JSON.parse(readUtf8(packageJsonPath)) as {
			peerDependencies?: Record<string, string>;
			scripts?: Record<string, string>;
		};

		expect(packageJson.peerDependencies).toMatchObject({
			"@mariozechner/pi-ai": "^0.60.0",
			"@mariozechner/pi-coding-agent": "^0.60.0",
		});
		expect(packageJson.scripts?.build).toBe("rm -rf dist && tsc --build");
		expect(packageJson.scripts?.["check:ci"]).toBe("biome ci .");
	});

	it("keeps Pi command execution shell-capable by including bash in wrapper PATH", () => {
		const piPackage = readUtf8(piPackagePath);
		const appModule = readUtf8(appModulePath);

		expect(piPackage).toContain("makeBinPath [ bash fd ripgrep ]");
		expect(appModule).toContain("pkgs.bash");
		expect(appModule).toContain("shellPath =");
		expect(appModule).toContain("/bin/bash");
		expect(appModule).toContain("envFiles");
		expect(appModule).toContain("sourceEnvFilesSnippet");
		expect(appModule).toContain("systemd.tmpfiles.settings.nixpi-app");
		expect(appModule).toContain("systemd-tmpfiles");
		expect(existsSync(appModulePath)).toBe(true);
		expect(existsSync(piPackagePath)).toBe(true);
	});
});
