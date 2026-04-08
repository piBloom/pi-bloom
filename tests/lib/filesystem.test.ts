import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	assertSupportedRebuildBranch,
	assertValidPrimaryUser,
	atomicWriteFile,
	ensureDir,
	getCanonicalRepoDir,
	getNixPiDir,
	getBootstrapMode,
	getNixPiStateDir,
	getPiDir,
	getPrimaryUser,
	getQuadletDir,
	getSystemFlakeDir,
	getUpdateStatusPath,
	isBootstrapMode,
	readPackageVersion,
	resolvePackageDir,
	safePath,
} from "../../core/lib/filesystem.js";

const ROOT = path.join(os.tmpdir(), "nixpi-fs-test-root");

// ---------------------------------------------------------------------------
// safePath
// ---------------------------------------------------------------------------
describe("safePath", () => {
	it("resolves a valid subpath under the root", () => {
		const result = safePath(ROOT, "Skills", "my-skill");
		expect(result).toBe(path.join(ROOT, "Skills", "my-skill"));
	});

	it("allows a path equal to the root (no segments)", () => {
		const result = safePath(ROOT);
		expect(result).toBe(path.resolve(ROOT));
	});

	it("throws on path traversal with ../", () => {
		expect(() => safePath(ROOT, "../escape")).toThrow("Path traversal blocked");
	});

	it("throws on deep path traversal that escapes root", () => {
		expect(() => safePath(ROOT, "Skills", "../../etc/passwd")).toThrow("Path traversal blocked");
	});

	it("handles nested valid subpath correctly", () => {
		const result = safePath(ROOT, "Objects", "notes", "my-note.md");
		expect(result).toBe(path.join(ROOT, "Objects", "notes", "my-note.md"));
	});
});

// ---------------------------------------------------------------------------
// getNixPiDir
// ---------------------------------------------------------------------------
describe("getNixPiDir", () => {
	let origNixPiDir: string | undefined;
	let origSystemFlakeDir: string | undefined;

	beforeEach(() => {
		origNixPiDir = process.env.NIXPI_DIR;
		origSystemFlakeDir = process.env.NIXPI_SYSTEM_FLAKE_DIR;
	});

	afterEach(() => {
		if (origNixPiDir !== undefined) {
			process.env.NIXPI_DIR = origNixPiDir;
		} else {
			delete process.env.NIXPI_DIR;
		}
		if (origSystemFlakeDir !== undefined) {
			process.env.NIXPI_SYSTEM_FLAKE_DIR = origSystemFlakeDir;
		} else {
			delete process.env.NIXPI_SYSTEM_FLAKE_DIR;
		}
	});

	it("returns NIXPI_DIR when env var is set", () => {
		process.env.NIXPI_DIR = "/custom/nixpi";
		expect(getNixPiDir()).toBe("/custom/nixpi");
	});

	it("falls back to ~/nixpi for the user workspace when env var is not set", () => {
		delete process.env.NIXPI_DIR;
		const expected = path.join(os.homedir(), "nixpi");
		expect(getNixPiDir()).toBe(expected);
	});

	it("reflects changes to NIXPI_DIR dynamically", () => {
		process.env.NIXPI_DIR = "/first/path";
		expect(getNixPiDir()).toBe("/first/path");

		process.env.NIXPI_DIR = "/second/path";
		expect(getNixPiDir()).toBe("/second/path");
	});
});

// ---------------------------------------------------------------------------
// getSystemFlakeDir
// ---------------------------------------------------------------------------
describe("getSystemFlakeDir", () => {
	let origPrimaryUser: string | undefined;

	beforeEach(() => {
		origPrimaryUser = process.env.NIXPI_PRIMARY_USER;
		process.env.NIXPI_PRIMARY_USER = "alex";
	});

	afterEach(() => {
		if (origPrimaryUser !== undefined) {
			process.env.NIXPI_PRIMARY_USER = origPrimaryUser;
		} else {
			delete process.env.NIXPI_PRIMARY_USER;
		}
	});

	it("defaults to /etc/nixos for the system flake dir", () => {
		delete process.env.NIXPI_SYSTEM_FLAKE_DIR;
		delete process.env.NIXPI_DIR;
		expect(getSystemFlakeDir()).toBe("/etc/nixos");
	});

	it("stays aligned with the canonical repo even when NIXPI_DIR is set", () => {
		delete process.env.NIXPI_SYSTEM_FLAKE_DIR;
		process.env.NIXPI_DIR = "/workspace/nixpi";
		expect(getSystemFlakeDir()).toBe("/etc/nixos");
	});

	it("prefers explicit NIXPI_SYSTEM_FLAKE_DIR override", () => {
		process.env.NIXPI_DIR = "/workspace/nixpi";
		process.env.NIXPI_SYSTEM_FLAKE_DIR = "/system/flake";
		expect(getSystemFlakeDir()).toBe("/system/flake");
	});
});

// ---------------------------------------------------------------------------
// canonical repo policy
// ---------------------------------------------------------------------------
describe("canonical repo policy", () => {
	let origPrimaryUser: string | undefined;

	beforeEach(() => {
		origPrimaryUser = process.env.NIXPI_PRIMARY_USER;
	});

	afterEach(() => {
		if (origPrimaryUser !== undefined) {
			process.env.NIXPI_PRIMARY_USER = origPrimaryUser;
		} else {
			delete process.env.NIXPI_PRIMARY_USER;
		}
	});

	it("returns the configured primary user when NIXPI_PRIMARY_USER is set", () => {
		process.env.NIXPI_PRIMARY_USER = "pi";
		expect(getPrimaryUser()).toBe("pi");
	});

	it("requires NIXPI_PRIMARY_USER when running as root", () => {
		delete process.env.NIXPI_PRIMARY_USER;
		const userInfoSpy = vi.spyOn(os, "userInfo").mockReturnValue({ username: "root" } as os.UserInfo<string>);

		expect(() => getPrimaryUser()).toThrow(
			"NIXPI_PRIMARY_USER is required when resolving canonical repo paths as root",
		);

		userInfoSpy.mockRestore();
	});

	it("rejects invalid primary user values", () => {
		process.env.NIXPI_PRIMARY_USER = "../escape";
		expect(() => getPrimaryUser()).toThrow("Invalid primary user for canonical repo path: ../escape");
	});

	it("rejects invalid primary user arguments directly", () => {
		expect(() => assertValidPrimaryUser("../escape")).toThrow(
			"Invalid primary user for canonical repo path: ../escape",
		);
	});

	it("builds the canonical repo dir at /srv/nixpi", () => {
		expect(getCanonicalRepoDir()).toBe("/srv/nixpi");
	});

	it("rejects rebuild branches other than main", () => {
		expect(() => assertSupportedRebuildBranch("feature/test")).toThrow(
			"Supported rebuilds require /srv/nixpi to be on main",
		);
		expect(() => assertSupportedRebuildBranch("main")).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// ensureDir
// ---------------------------------------------------------------------------
describe("ensureDir", () => {
	let tmpRoot: string;

	beforeEach(() => {
		tmpRoot = mkdtempSync(path.join(os.tmpdir(), "nixpi-ensuredir-"));
	});

	afterEach(() => {
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	it("creates a directory that does not exist", () => {
		const target = path.join(tmpRoot, "new-dir");
		ensureDir(target);
		expect(existsSync(target)).toBe(true);
	});

	it("does nothing when the directory already exists", () => {
		const target = path.join(tmpRoot, "existing");
		mkdirSync(target);
		expect(() => ensureDir(target)).not.toThrow();
		expect(existsSync(target)).toBe(true);
	});

	it("creates nested directories recursively", () => {
		const target = path.join(tmpRoot, "a", "b", "c");
		ensureDir(target);
		expect(existsSync(target)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// atomicWriteFile
// ---------------------------------------------------------------------------
describe("atomicWriteFile", () => {
	let tmpRoot: string;

	beforeEach(() => {
		tmpRoot = mkdtempSync(path.join(os.tmpdir(), "nixpi-atomic-"));
	});

	afterEach(() => {
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	it("writes content to a new file", () => {
		const target = path.join(tmpRoot, "output.txt");
		atomicWriteFile(target, "hello world");
		expect(readFileSync(target, "utf-8")).toBe("hello world");
	});

	it("overwrites existing file content", () => {
		const target = path.join(tmpRoot, "output.txt");
		writeFileSync(target, "old content");
		atomicWriteFile(target, "new content");
		expect(readFileSync(target, "utf-8")).toBe("new content");
	});

	it("creates parent directories automatically", () => {
		const target = path.join(tmpRoot, "sub", "dir", "file.txt");
		atomicWriteFile(target, "deep content");
		expect(readFileSync(target, "utf-8")).toBe("deep content");
	});

	it("leaves no .tmp file on success", () => {
		const target = path.join(tmpRoot, "output.txt");
		atomicWriteFile(target, "data");
		expect(existsSync(`${target}.tmp`)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// path helpers that depend on env vars
// ---------------------------------------------------------------------------
describe("env-based path helpers", () => {
	let origStateDir: string | undefined;
	let origPiDir: string | undefined;

	beforeEach(() => {
		origStateDir = process.env.NIXPI_STATE_DIR;
		origPiDir = process.env.NIXPI_PI_DIR;
	});

	afterEach(() => {
		if (origStateDir !== undefined) process.env.NIXPI_STATE_DIR = origStateDir;
		else delete process.env.NIXPI_STATE_DIR;
		if (origPiDir !== undefined) process.env.NIXPI_PI_DIR = origPiDir;
		else delete process.env.NIXPI_PI_DIR;
	});

	it("getNixPiStateDir returns NIXPI_STATE_DIR env or ~/.nixpi fallback", () => {
		process.env.NIXPI_STATE_DIR = "/custom/state";
		expect(getNixPiStateDir()).toBe("/custom/state");
		delete process.env.NIXPI_STATE_DIR;
		expect(getNixPiStateDir()).toBe(path.join(os.homedir(), ".nixpi"));
	});

	it("getPiDir returns NIXPI_PI_DIR env or ~/.pi fallback", () => {
		process.env.NIXPI_PI_DIR = "/custom/pi";
		expect(getPiDir()).toBe("/custom/pi");
		delete process.env.NIXPI_PI_DIR;
		expect(getPiDir()).toBe(path.join(os.homedir(), ".pi"));
	});

	it("getBootstrapMode defaults to steady", () => {
		delete process.env.NIXPI_BOOTSTRAP_MODE;
		expect(getBootstrapMode()).toBe("steady");
		expect(isBootstrapMode()).toBe(false);
	});

	it("getBootstrapMode accepts bootstrap aliases", () => {
		for (const value of ["bootstrap", "1", "true", "TRUE"]) {
			process.env.NIXPI_BOOTSTRAP_MODE = value;
			expect(getBootstrapMode()).toBe("bootstrap");
			expect(isBootstrapMode()).toBe(true);
		}
	});

	it("getBootstrapMode treats other values as steady", () => {
		process.env.NIXPI_BOOTSTRAP_MODE = "steady";
		expect(getBootstrapMode()).toBe("steady");
		expect(isBootstrapMode()).toBe(false);
	});

	it("getUpdateStatusPath is inside state dir", () => {
		process.env.NIXPI_STATE_DIR = "/s";
		expect(getUpdateStatusPath()).toBe("/s/update-status.json");
	});

	it("getQuadletDir is under ~/.config/containers/systemd", () => {
		const result = getQuadletDir();
		expect(result).toBe(path.join(os.homedir(), ".config", "containers", "systemd"));
	});
});

// ---------------------------------------------------------------------------
// resolvePackageDir / readPackageVersion
// ---------------------------------------------------------------------------
describe("resolvePackageDir", () => {
	it("finds a directory with package.json by walking up", () => {
		// Use the current module URL — the actual package root should be found
		const dir = resolvePackageDir(import.meta.url);
		expect(existsSync(path.join(dir, "package.json"))).toBe(true);
	});
});

describe("readPackageVersion", () => {
	let tmpRoot: string;

	beforeEach(() => {
		tmpRoot = mkdtempSync(path.join(os.tmpdir(), "nixpi-pkgver-"));
	});

	afterEach(() => {
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	it("reads version from a valid package.json", () => {
		writeFileSync(path.join(tmpRoot, "package.json"), JSON.stringify({ version: "1.2.3" }));
		expect(readPackageVersion(tmpRoot)).toBe("1.2.3");
	});

	it("returns 0.1.0 when package.json has no version field", () => {
		writeFileSync(path.join(tmpRoot, "package.json"), JSON.stringify({ name: "test" }));
		expect(readPackageVersion(tmpRoot)).toBe("0.1.0");
	});

	it("returns 0.1.0 when package.json is absent", () => {
		expect(readPackageVersion(tmpRoot)).toBe("0.1.0");
	});

	it("returns 0.1.0 when package.json contains invalid JSON", () => {
		writeFileSync(path.join(tmpRoot, "package.json"), "not-json");
		expect(readPackageVersion(tmpRoot)).toBe("0.1.0");
	});
});
