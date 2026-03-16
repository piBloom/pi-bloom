import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleScaffold } from "../../core/pi-extensions/bloom-services/actions-scaffold.js";

describe("handleScaffold", () => {
	let repoDir: string;

	beforeEach(() => {
		repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "bloom-scaffold-"));
		fs.mkdirSync(path.join(repoDir, "services"), { recursive: true });
		fs.writeFileSync(path.join(repoDir, "package.json"), "{}\n");
		fs.writeFileSync(
			path.join(repoDir, "services", "catalog.yaml"),
			["version: 1", "source_repo: https://github.com/alexradunet/piBloom", "services: {}", "bridges: {}", ""].join("\n"),
		);
	});

	afterEach(() => {
		fs.rmSync(repoDir, { recursive: true, force: true });
	});

	it("adds Home metadata for web services to the catalog", async () => {
		const result = (await handleScaffold(
			{
				name: "demo-api",
				description: "Demo HTTP API",
				image: "docker.io/library/nginx:1.29.1-alpine",
				version: "0.1.0",
				port: 9080,
				container_port: 80,
				web_service: true,
				title: "Demo API",
				icon_text: "API",
				path_hint: "/srv/demo",
				access_path: "/health",
			},
			{ cwd: repoDir } as never,
		)) as { isError?: boolean };

		expect(result.isError).toBeUndefined();
		const catalog = fs.readFileSync(path.join(repoDir, "services", "catalog.yaml"), "utf-8");
		expect(catalog).toContain("demo-api:");
		expect(catalog).toContain("home_visible: true");
		expect(catalog).toContain("port: 9080");
		expect(catalog).toContain("title: Demo API");
		expect(catalog).toContain("access_path: /health");
	});

	it("rejects web services without a published port", async () => {
		const result = (await handleScaffold(
			{
				name: "demo-api",
				description: "Demo HTTP API",
				image: "docker.io/library/nginx:1.29.1-alpine",
				web_service: true,
			},
			{ cwd: repoDir } as never,
		)) as { isError?: boolean; content: Array<{ text: string }> };

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("web_service=true requires port");
	});
});
