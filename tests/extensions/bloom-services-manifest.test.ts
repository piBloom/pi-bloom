import { beforeEach, describe, expect, it, vi } from "vitest";

const runMock = vi.fn();
const loadManifestMock = vi.fn();
const saveManifestMock = vi.fn();
const writeServiceHomeRuntimeMock = vi.fn();
const detectRunningServicesMock = vi.fn();

vi.mock("../../core/lib/exec.js", () => ({
	run: runMock,
}));

vi.mock("../../core/lib/services-manifest.js", () => ({
	loadManifest: loadManifestMock,
	saveManifest: saveManifestMock,
}));

vi.mock("../../core/lib/service-home.js", () => ({
	writeServiceHomeRuntime: writeServiceHomeRuntimeMock,
}));

vi.mock("../../core/lib/shared.js", () => ({
	errorResult: (message: string) => ({
		content: [{ type: "text" as const, text: message }],
		details: {},
		isError: true,
	}),
}));

vi.mock("../../core/pi-extensions/bloom-services/service-io.js", () => ({
	detectRunningServices: detectRunningServicesMock,
}));

describe("bloom-services manifest handlers", () => {
	beforeEach(() => {
		vi.resetModules();
		runMock.mockReset();
		loadManifestMock.mockReset();
		saveManifestMock.mockReset();
		writeServiceHomeRuntimeMock.mockReset();
		detectRunningServicesMock.mockReset();

		loadManifestMock.mockReturnValue({
			device: "bloom-box",
			os_image: "ghcr.io/bloom/old:1",
			services: {
				app: { image: "ghcr.io/bloom/app:1", enabled: true },
				idle: { image: "ghcr.io/bloom/idle:1", enabled: false },
			},
		});
		detectRunningServicesMock.mockResolvedValue(
			new Map([
				["app", { image: "ghcr.io/bloom/app:2" }],
				["newsvc", { image: "ghcr.io/bloom/newsvc:1" }],
			]),
		);
		runMock.mockResolvedValue({
			exitCode: 0,
			stdout: JSON.stringify({
				status: {
					booted: {
						image: {
							image: {
								image: "ghcr.io/bloom/os:2",
							},
						},
					},
				},
			}),
			stderr: "",
		});
		writeServiceHomeRuntimeMock.mockResolvedValue(undefined);
	});

	it("updates the manifest from detected running services and refreshes the runtime home", async () => {
		const { handleManifestSync } = await import("../../core/pi-extensions/bloom-services/actions-manifest.js");

		const result = await handleManifestSync({ mode: "update" }, "/tmp/Bloom/manifest.yaml", "/tmp/repo", undefined);

		expect(saveManifestMock).toHaveBeenCalledWith(
			{
				device: "bloom-box",
				os_image: "ghcr.io/bloom/os:2",
				services: {
					app: { image: "ghcr.io/bloom/app:2", enabled: true },
					idle: { image: "ghcr.io/bloom/idle:1", enabled: false },
					newsvc: { image: "ghcr.io/bloom/newsvc:1", enabled: true },
				},
			},
			"/tmp/Bloom/manifest.yaml",
		);
		expect(writeServiceHomeRuntimeMock).toHaveBeenCalledWith("/home/alex/.config/bloom", "/tmp/repo", undefined);
		expect(result.content[0].text).toContain("Manifest updated. Resolved");
	});

	it("writes a single service entry and refreshes the runtime home when setting a service", async () => {
		loadManifestMock.mockReturnValue({ services: {} });

		const { handleManifestSetService } = await import("../../core/pi-extensions/bloom-services/actions-manifest.js");

		const result = await handleManifestSetService(
			{ name: "dufs", image: "ghcr.io/bloom/dufs:1", version: "1.0.0", enabled: false },
			"/tmp/Bloom/manifest.yaml",
			"/tmp/repo",
		);

		expect(saveManifestMock).toHaveBeenCalledWith(
			{
				services: {
					dufs: { image: "ghcr.io/bloom/dufs:1", version: "1.0.0", enabled: false },
				},
			},
			"/tmp/Bloom/manifest.yaml",
		);
		expect(writeServiceHomeRuntimeMock).toHaveBeenCalledWith("/home/alex/.config/bloom", "/tmp/repo");
		expect(result.content[0].text).toContain("Service dufs set in manifest");
	});
});
