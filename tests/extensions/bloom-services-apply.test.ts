import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runMock = vi.fn();
const loadServiceCatalogMock = vi.fn();
const loadManifestMock = vi.fn();
const saveManifestMock = vi.fn();
const requireConfirmationMock = vi.fn();
const truncateMock = vi.fn((text: string) => text);
const getQuadletDirMock = vi.fn();
const ensureServiceInstalledMock = vi.fn();
const writeServiceHomeRuntimeMock = vi.fn();

vi.mock("../../core/lib/exec.js", () => ({
	run: runMock,
}));

vi.mock("../../core/lib/filesystem.js", () => ({
	getQuadletDir: getQuadletDirMock,
}));

vi.mock("../../core/lib/services-catalog.js", () => ({
	loadServiceCatalog: loadServiceCatalogMock,
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
	requireConfirmation: requireConfirmationMock,
	truncate: truncateMock,
}));

vi.mock("../../core/pi-extensions/bloom-services/actions-install.js", () => ({
	ensureServiceInstalled: ensureServiceInstalledMock,
}));

describe("handleManifestApply", () => {
	let quadletDir: string;

	beforeEach(() => {
		vi.resetModules();
		runMock.mockReset();
		loadServiceCatalogMock.mockReset();
		loadManifestMock.mockReset();
		saveManifestMock.mockReset();
		requireConfirmationMock.mockReset();
		truncateMock.mockClear();
		getQuadletDirMock.mockReset();
		ensureServiceInstalledMock.mockReset();
		writeServiceHomeRuntimeMock.mockReset();

		quadletDir = fs.mkdtempSync(path.join(os.tmpdir(), "bloom-apply-quadlet-"));
		getQuadletDirMock.mockReturnValue(quadletDir);
		loadServiceCatalogMock.mockReturnValue({
			app: {
				version: "1.2.3",
				image: "localhost/bloom-app:latest",
				depends: ["db"],
				models: [{ volume: "models", path: "app.gguf", url: "https://example.invalid/app.gguf" }],
			},
		});
		loadManifestMock.mockReturnValue({
			services: {
				app: { image: "unknown", enabled: true },
			},
		});
		requireConfirmationMock.mockResolvedValue(null);
		runMock.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
		writeServiceHomeRuntimeMock.mockResolvedValue(undefined);
		ensureServiceInstalledMock.mockImplementation(async () => {
			fs.writeFileSync(path.join(quadletDir, "bloom-app.container"), "[Container]\nImage=test\n");
			return {
				ok: true,
				catalogEntry: {
					version: "1.2.3",
					image: "localhost/bloom-app:latest",
					depends: ["db"],
					models: [{ volume: "models", path: "app.gguf", url: "https://example.invalid/app.gguf" }],
				},
				depsInstalled: ["db"],
			};
		});
	});

	afterEach(() => {
		fs.rmSync(quadletDir, { recursive: true, force: true });
	});

	it("uses the shared secure install path for missing services", async () => {
		const { handleManifestApply } = await import("../../core/pi-extensions/bloom-services/actions-apply.js");
		const result = (await handleManifestApply(
			{ install_missing: true },
			"/tmp/Bloom",
			"/tmp/Bloom/manifest.yaml",
			"/tmp/repo",
			undefined,
			{ hasUI: true, ui: { confirm: vi.fn() } } as never,
		)) as { isError?: boolean; content: Array<{ text: string }> };

		expect(result.isError).toBe(false);
		expect(ensureServiceInstalledMock).toHaveBeenCalledWith(
			"app",
			loadServiceCatalogMock.mock.results[0].value,
			"/tmp/Bloom",
			"/tmp/Bloom/manifest.yaml",
			"/tmp/repo",
			undefined,
		);
		expect(runMock).toHaveBeenCalledWith("systemctl", ["--user", "daemon-reload"], undefined);
		expect(saveManifestMock).toHaveBeenCalledWith(
			{
				services: {
					app: {
						image: "localhost/bloom-app:latest",
						version: "1.2.3",
						enabled: true,
					},
				},
			},
			"/tmp/Bloom/manifest.yaml",
		);
		expect(writeServiceHomeRuntimeMock).toHaveBeenCalledWith("/home/alex/.config/bloom", "/tmp/repo", undefined);
		expect(result.content[0].text).toContain("Installed app from bundled local package");
	});
});
