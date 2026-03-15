import { describe, expect, it } from "vitest";
import { buildServiceHomeCards, renderServiceHomeHtml } from "../../core/lib/service-home.js";

describe("buildServiceHomeCards", () => {
	it("renders service URLs, path hints, and running status from catalog metadata", () => {
		const cards = buildServiceHomeCards({
			catalog: {
				home: {
					title: "Bloom Home",
					description: "Landing page",
					icon_text: "HM",
					port: 8080,
				},
				dufs: {
					title: "Bloom Files",
					description: "WebDAV share",
					icon_text: "FS",
					port: 5000,
					path_hint: "~/Public/Bloom",
				},
			},
			installedServices: ["home", "dufs"],
			runningServices: new Set(["home"]),
			meshAccess: { preferredHost: "bloom.mesh" },
		});

		expect(cards).toEqual([
			{
				name: "home",
				title: "Bloom Home",
				description: "Landing page",
				iconText: "HM",
				status: "running",
				url: "http://bloom.mesh:8080",
			},
			{
				name: "dufs",
				title: "Bloom Files",
				description: "WebDAV share",
				iconText: "FS",
				pathHint: "~/Public/Bloom",
				status: "installed",
				url: "http://bloom.mesh:5000",
			},
		]);
	});
});

describe("renderServiceHomeHtml", () => {
	it("includes share URL, alternate hosts, and service metadata", () => {
		const html = renderServiceHomeHtml({
			meshAccess: {
				preferredHost: "bloom.example.net",
				fqdn: "bloom.example.net",
				meshIp: "100.64.0.8",
			},
			cards: [
				{
					name: "dufs",
					title: "Bloom Files",
					description: "WebDAV share",
					iconText: "FS",
					pathHint: "~/Public/Bloom",
					status: "running",
					url: "http://bloom.example.net:5000",
				},
			],
			generatedAt: "2026-03-15T09:00:00.000Z",
		});

		expect(html).toContain("http://bloom.example.net:8080");
		expect(html).toContain("http://100.64.0.8:8080");
		expect(html).toContain("Bloom Files");
		expect(html).toContain("~/Public/Bloom");
		expect(html).toContain("Generated 2026-03-15T09:00:00.000Z");
	});
});
