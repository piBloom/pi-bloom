import { describe, expect, it } from "vitest";
import { buildServiceHomeCards, renderServiceHomeHtml } from "../../core/lib/service-home.js";

describe("buildServiceHomeCards", () => {
	it("renders only Home-visible services with URLs, path hints, and running status from catalog metadata", () => {
		const cards = buildServiceHomeCards({
			catalog: {
				dufs: {
					title: "Bloom Files",
					description: "WebDAV share",
					icon_text: "FS",
					home_visible: true,
					port: 5000,
					path_hint: "~/Public/Bloom",
				},
				worker: {
					title: "Background Worker",
					description: "Hidden service",
					port: 7000,
				},
			},
			installedServices: ["dufs"],
			runningServices: new Set(["dufs"]),
			meshAccess: { preferredHost: "bloom.mesh" },
		});

		expect(cards).toEqual([
			{
				name: "dufs",
				title: "Bloom Files",
				description: "WebDAV share",
				iconText: "FS",
				pathHint: "~/Public/Bloom",
				status: "running",
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
