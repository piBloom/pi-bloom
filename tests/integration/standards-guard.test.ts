import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const packageJsonPath = path.join(repoRoot, "package.json");
const ttydModulePath = path.join(repoRoot, "core/os/modules/ttyd.nix");

describe("repo standards guards", () => {
	it("configures VitePress for GitHub Project Pages", () => {
		const vitePressConfig = readFileSync(path.join(repoRoot, "docs/.vitepress/config.ts"), "utf8");

		expect(vitePressConfig).toContain('base: "/NixPI/"');
	});

	it("declares compatible Pi peer dependency ranges and CI checks", () => {
		const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
			peerDependencies?: Record<string, string>;
			scripts?: Record<string, string>;
		};

		expect(packageJson.peerDependencies).toMatchObject({
			"@mariozechner/pi-ai": "^0.60.0",
			"@mariozechner/pi-coding-agent": "^0.60.0",
		});
		expect(packageJson.scripts?.["check:ci"]).toBe("biome ci .");
	});

	it("keeps the browser terminal writable for operator input", () => {
		const ttydModule = readFileSync(ttydModulePath, "utf8");

		expect(ttydModule).toContain("--writable");
		expect(ttydModule).toContain("--port 7681");
	});
});
