import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildLocalImage, downloadServiceModels } from "../../core/extensions/bloom-services/service-io.js";
import { findLocalServicePackage, loadServiceCatalog } from "../../core/lib/services-catalog.js";
import { loadManifest, saveManifest } from "../../core/lib/services-manifest.js";
import { hasSubidRange } from "../../core/lib/services-validation.js";

describe("loadManifest", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "manifest-test-"));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("returns empty manifest for nonexistent file", () => {
		const manifest = loadManifest(join(tempDir, "does-not-exist.yaml"));
		expect(manifest).toEqual({ services: {} });
	});

	it("returns empty manifest for null YAML content", () => {
		const path = join(tempDir, "manifest.yaml");
		writeFileSync(path, "");
		const manifest = loadManifest(path);
		expect(manifest).toEqual({ services: {} });
	});

	it("loads a valid manifest", () => {
		const path = join(tempDir, "manifest.yaml");
		writeFileSync(
			path,
			[
				"device: test-host",
				"os_image: ghcr.io/pibloom/bloom-os:latest",
				"services:",
				"  llm:",
				"    image: ghcr.io/ggml-org/llama.cpp:server",
				"    version: '0.1.0'",
				"    enabled: true",
			].join("\n"),
		);
		const manifest = loadManifest(path);
		expect(manifest.device).toBe("test-host");
		expect(manifest.os_image).toBe("ghcr.io/pibloom/bloom-os:latest");
		expect(manifest.services.llm).toBeDefined();
		expect(manifest.services.llm.enabled).toBe(true);
	});
});

describe("saveManifest + loadManifest roundtrip", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "manifest-roundtrip-"));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("saves and reloads a manifest correctly", () => {
		const manifestPath = join(tempDir, "Bloom", "manifest.yaml");
		const original = {
			device: "bloom-device",
			os_image: "ghcr.io/pibloom/bloom-os:0.1.0",
			services: {
				llm: {
					image: "ghcr.io/ggml-org/llama.cpp:server",
					version: "0.1.0",
					enabled: true,
				},
				netbird: {
					image: "netbirdio/netbird@sha256:b3e69490e58cf255caf1b9b6a8bbfcfae4d1b2bbaa3c40a06cfdbba5b8fdc0d2",
					enabled: false,
				},
			},
		};

		saveManifest(original, manifestPath);
		const reloaded = loadManifest(manifestPath);

		expect(reloaded.device).toBe("bloom-device");
		expect(reloaded.os_image).toBe("ghcr.io/pibloom/bloom-os:0.1.0");
		expect(reloaded.services.llm.image).toBe("ghcr.io/ggml-org/llama.cpp:server");
		expect(reloaded.services.llm.version).toBe("0.1.0");
		expect(reloaded.services.llm.enabled).toBe(true);
		expect(reloaded.services.netbird.enabled).toBe(false);
	});

	it("creates parent Bloom directory if missing", () => {
		const manifestPath = join(tempDir, "Bloom", "manifest.yaml");
		saveManifest({ services: {} }, manifestPath);
		const raw = readFileSync(manifestPath, "utf-8");
		expect(raw).toContain("services");
	});
});

describe("loadManifest with malformed YAML", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "manifest-malformed-"));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("moves invalid YAML aside and returns an empty manifest", () => {
		const path = join(tempDir, "manifest.yaml");
		// A YAML document with duplicate merge keys triggers a parse error
		writeFileSync(path, "a: &a\n  b: *z\n");
		const manifest = loadManifest(path);
		expect(manifest).toEqual({ services: {} });
		expect(existsSync(path)).toBe(false);
	});

	it("moves structurally invalid manifests aside", () => {
		const path = join(tempDir, "manifest.yaml");
		writeFileSync(path, "device: test-host\n");
		const manifest = loadManifest(path);
		expect(manifest).toEqual({ services: {} });
		expect(existsSync(path)).toBe(false);
	});
});

describe("loadServiceCatalog", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "catalog-test-"));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("returns empty object for nonexistent repo dir", () => {
		const catalog = loadServiceCatalog("/tmp/__bloom_no_such_repo__");
		expect(typeof catalog).toBe("object");
	});

	it("loads a valid catalog from repo dir", () => {
		const catalogDir = join(tempDir, "services");
		mkdirSync(catalogDir, { recursive: true });
		writeFileSync(
			join(catalogDir, "catalog.yaml"),
			["services:", "  llm:", "    version: '0.1.0'", "    category: ai"].join("\n"),
		);
		const catalog = loadServiceCatalog(tempDir);
		expect(catalog.llm).toBeDefined();
		expect(catalog.llm.version).toBe("0.1.0");
		expect(catalog.llm.category).toBe("ai");
	});

	it("loads catalog with depends fields", () => {
		const catalogDir = join(tempDir, "services");
		mkdirSync(catalogDir, { recursive: true });
		writeFileSync(
			join(catalogDir, "catalog.yaml"),
			[
				"services:",
				"  app-frontend:",
				"    version: '0.1.0'",
				"    category: development",
				"    image: localhost/bloom-app-frontend:latest",
				"    depends: [app-backend]",
				"  app-backend:",
				"    version: '0.1.0'",
				"    category: development",
				"    image: localhost/bloom-app-backend:latest",
			].join("\n"),
		);
		const catalog = loadServiceCatalog(tempDir);
		expect(catalog["app-frontend"].depends).toEqual(["app-backend"]);
		expect(catalog["app-backend"]).toBeDefined();
		expect(catalog["app-backend"].version).toBe("0.1.0");
	});

	it("skips catalog without services key and falls through", () => {
		// This tests the branch where doc.services is falsy
		const catalogDir = join(tempDir, "services");
		mkdirSync(catalogDir, { recursive: true });
		writeFileSync(join(catalogDir, "catalog.yaml"), "something_else: true\n");
		// When this temp dir is checked first and has no services key,
		// it falls through. The result depends on whether cwd has a catalog.
		const catalog = loadServiceCatalog(tempDir);
		expect(typeof catalog).toBe("object");
	});
});

describe("findLocalServicePackage", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "find-svc-"));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("returns null for nonexistent repo dir and service", () => {
		const result = findLocalServicePackage("nonexistent-service", "/tmp/__bloom_no_such_repo__");
		expect(result).toBeNull();
	});

	it("finds a service package with quadlet dir and SKILL.md", () => {
		const svcDir = join(tempDir, "services", "llm");
		const quadletDir = join(svcDir, "quadlet");
		mkdirSync(quadletDir, { recursive: true });
		writeFileSync(join(svcDir, "SKILL.md"), "---\nname: llm\n---\n");
		writeFileSync(join(quadletDir, "bloom-llm.container"), "[Container]\nImage=test");
		const result = findLocalServicePackage("llm", tempDir);
		expect(result).not.toBeNull();
		expect(result?.serviceDir).toBe(svcDir);
		expect(result?.quadletDir).toBe(quadletDir);
		expect(result?.skillPath).toBe(join(svcDir, "SKILL.md"));
	});

	it("returns null when quadlet exists but no SKILL.md in temp dir", () => {
		// Use a unique service name that won't exist in cwd fallback
		const svcDir = join(tempDir, "services", "nonexistent-test-svc-xyz");
		mkdirSync(join(svcDir, "quadlet"), { recursive: true });
		const result = findLocalServicePackage("nonexistent-test-svc-xyz", tempDir);
		expect(result).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// hasSubidRange (inlined from lib/system-checks.ts)
// ---------------------------------------------------------------------------
describe("hasSubidRange", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "system-checks-test-"));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("returns true when username entry exists", () => {
		const filePath = join(tempDir, "subuid");
		writeFileSync(filePath, "root:100000:65536\nalex:165536:65536\n");
		expect(hasSubidRange(filePath, "alex")).toBe(true);
	});

	it("returns true when username is the first entry", () => {
		const filePath = join(tempDir, "subuid");
		writeFileSync(filePath, "bloom:100000:65536\nother:165536:65536\n");
		expect(hasSubidRange(filePath, "bloom")).toBe(true);
	});

	it("returns false when username is not present", () => {
		const filePath = join(tempDir, "subuid");
		writeFileSync(filePath, "root:100000:65536\nother:165536:65536\n");
		expect(hasSubidRange(filePath, "alex")).toBe(false);
	});

	it("returns false for nonexistent file path", () => {
		const filePath = join(tempDir, "does-not-exist");
		expect(hasSubidRange(filePath, "alex")).toBe(false);
	});

	it("returns false for empty file", () => {
		const filePath = join(tempDir, "subuid");
		writeFileSync(filePath, "");
		expect(hasSubidRange(filePath, "alex")).toBe(false);
	});

	it("does not match partial username prefixes", () => {
		const filePath = join(tempDir, "subuid");
		writeFileSync(filePath, "alexander:100000:65536\n");
		expect(hasSubidRange(filePath, "alex")).toBe(false);
	});

	it("handles lines with leading whitespace", () => {
		const filePath = join(tempDir, "subuid");
		writeFileSync(filePath, "  alex:100000:65536\n");
		expect(hasSubidRange(filePath, "alex")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// buildLocalImage
// ---------------------------------------------------------------------------
describe("buildLocalImage", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "build-img-"));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("returns skip result when image does not start with localhost/", async () => {
		const result = await buildLocalImage("llm", "ghcr.io/ggml-org/llama.cpp:server", tempDir);
		expect(result.skipped).toBe(true);
		expect(result.ok).toBe(true);
	});

	it("returns error when service source dir is missing", async () => {
		const result = await buildLocalImage("myservice", "localhost/bloom-myservice:latest", "/tmp/__nonexistent__");
		expect(result.skipped).toBe(false);
		expect(result.ok).toBe(false);
		expect(result.note).toContain("not found");
	});
});

// ---------------------------------------------------------------------------
// downloadServiceModels
// ---------------------------------------------------------------------------
describe("downloadServiceModels", () => {
	it("returns success with 0 downloaded for empty models array", async () => {
		const result = await downloadServiceModels([]);
		expect(result.ok).toBe(true);
		expect(result.downloaded).toBe(0);
	});
});
