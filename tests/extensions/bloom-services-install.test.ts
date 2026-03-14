import { beforeEach, describe, expect, it, vi } from "vitest";

const runMock = vi.fn();
const installServicePackageMock = vi.fn();
const buildLocalImageMock = vi.fn();
const downloadServiceModelsMock = vi.fn();
const loadServiceCatalogMock = vi.fn();
const servicePreflightErrorsMock = vi.fn();
const loadManifestMock = vi.fn();
const saveManifestMock = vi.fn();
const getQuadletDirMock = vi.fn();

vi.mock("../../core/lib/exec.js", () => ({
	run: runMock,
}));

vi.mock("../../core/lib/filesystem.js", () => ({
	getQuadletDir: getQuadletDirMock,
}));

vi.mock("../../core/lib/services-catalog.js", () => ({
	loadServiceCatalog: loadServiceCatalogMock,
	servicePreflightErrors: servicePreflightErrorsMock,
}));

vi.mock("../../core/lib/services-manifest.js", () => ({
	loadManifest: loadManifestMock,
	saveManifest: saveManifestMock,
}));

vi.mock("../../core/extensions/bloom-services/service-io.js", () => ({
	installServicePackage: installServicePackageMock,
	buildLocalImage: buildLocalImageMock,
	downloadServiceModels: downloadServiceModelsMock,
}));

describe("handleInstall", () => {
	beforeEach(() => {
		vi.resetModules();
		runMock.mockReset();
		installServicePackageMock.mockReset();
		buildLocalImageMock.mockReset();
		downloadServiceModelsMock.mockReset();
		loadServiceCatalogMock.mockReset();
		servicePreflightErrorsMock.mockReset();
		loadManifestMock.mockReset();
		saveManifestMock.mockReset();
		getQuadletDirMock.mockReset();

		getQuadletDirMock.mockReturnValue("/quadlet");
		loadManifestMock.mockReturnValue({ services: {} });
		runMock.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
		buildLocalImageMock.mockResolvedValue({ ok: true, skipped: true });
		downloadServiceModelsMock.mockResolvedValue({ ok: true, downloaded: 0 });
		servicePreflightErrorsMock.mockResolvedValue([]);
	});

	it("fails before touching the primary service when a dependency install fails", async () => {
		loadServiceCatalogMock.mockReturnValue({
			app: { image: "localhost/bloom-app:latest", depends: ["db"] },
			db: { image: "docker.io/library/postgres:16" },
		});
		installServicePackageMock.mockImplementation(async (name: string) => {
			if (name === "db") {
				return { ok: false, note: "dependency exploded" };
			}
			return { ok: true, source: "local", ref: name };
		});

		const { handleInstall } = await import("../../core/extensions/bloom-services/actions-install.js");
		const result = (await handleInstall(
			{ name: "app" },
			"/tmp/Bloom",
			"/tmp/Bloom/manifest.yaml",
			"/tmp/repo",
			undefined,
		)) as { isError?: boolean; content: Array<{ text: string }> };

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Dependency db failed: dependency exploded while installing app");
		expect(installServicePackageMock).toHaveBeenCalledTimes(1);
		expect(installServicePackageMock).toHaveBeenCalledWith("db", "/tmp/Bloom", "/tmp/repo", undefined);
		expect(buildLocalImageMock).not.toHaveBeenCalledWith(
			"app",
			expect.anything(),
			expect.anything(),
			expect.anything(),
		);
		expect(saveManifestMock).not.toHaveBeenCalled();
	});
});
