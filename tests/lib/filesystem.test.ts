import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	assertCanonicalRepo,
	getCanonicalRepoDir,
	getNixPiDir,
	getNixPiRepoDir,
	getPrimaryUser,
	getSystemFlakeDir,
	safePath,
} from "../../core/lib/filesystem.js";
import { getCanonicalRepoMetadataPath } from "../../core/lib/repo-metadata.js";

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

	it("falls back to ~/nixpi when env var is not set", () => {
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
	it("defaults to the canonical ~/nixpi checkout", () => {
		delete process.env.NIXPI_SYSTEM_FLAKE_DIR;
		delete process.env.NIXPI_DIR;
		expect(getSystemFlakeDir()).toBe(path.join(os.homedir(), "nixpi"));
	});

	it("stays aligned with the canonical repo even when NIXPI_DIR is set", () => {
		delete process.env.NIXPI_SYSTEM_FLAKE_DIR;
		process.env.NIXPI_DIR = "/workspace/nixpi";
		expect(getSystemFlakeDir()).toBe(path.join(os.homedir(), "nixpi"));
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
	let origRepoDir: string | undefined;

	beforeEach(() => {
		origPrimaryUser = process.env.NIXPI_PRIMARY_USER;
		origRepoDir = process.env.NIXPI_REPO_DIR;
	});

	afterEach(() => {
		if (origPrimaryUser !== undefined) {
			process.env.NIXPI_PRIMARY_USER = origPrimaryUser;
		} else {
			delete process.env.NIXPI_PRIMARY_USER;
		}
		if (origRepoDir !== undefined) {
			process.env.NIXPI_REPO_DIR = origRepoDir;
		} else {
			delete process.env.NIXPI_REPO_DIR;
		}
	});

	it("returns the configured primary user when NIXPI_PRIMARY_USER is set", () => {
		process.env.NIXPI_PRIMARY_USER = "pi";
		expect(getPrimaryUser()).toBe("pi");
	});

	it("builds the canonical repo dir under /home/<primaryUser>/nixpi", () => {
		expect(getCanonicalRepoDir("alex")).toBe("/home/alex/nixpi");
	});

	it("defaults the repo dir to /home/<primaryUser>/nixpi", () => {
		delete process.env.NIXPI_REPO_DIR;
		process.env.NIXPI_PRIMARY_USER = "alex";
		expect(getNixPiRepoDir()).toBe("/home/alex/nixpi");
	});

	it("builds the canonical repo metadata path under /home/<primaryUser>/.nixpi", () => {
		expect(getCanonicalRepoMetadataPath("alex")).toBe("/home/alex/.nixpi/canonical-repo.json");
	});

	it("rejects repos outside the canonical path", () => {
		expect(() =>
			assertCanonicalRepo({
				path: "/home/alex/.nixpi/pi-nixpi",
			}),
		).toThrow("Canonical repo path mismatch: expected /home/alex/nixpi, got /home/alex/.nixpi/pi-nixpi");
	});

	it("rejects repos with the wrong origin", () => {
		expect(() =>
			assertCanonicalRepo({
				path: "/home/alex/nixpi",
				origin: "git@github.com:alexradunet/nixpi.git",
				expectedOrigin: "https://github.com/alexradunet/nixpi.git",
			}),
		).toThrow(
			"Canonical repo origin mismatch: expected https://github.com/alexradunet/nixpi.git, got git@github.com:alexradunet/nixpi.git",
		);
	});

	it("rejects repos on the wrong branch", () => {
		expect(() =>
			assertCanonicalRepo({
				path: "/home/alex/nixpi",
				origin: "https://github.com/alexradunet/nixpi.git",
				branch: "feature/task-1",
				expectedBranch: "main",
			}),
		).toThrow("Canonical repo branch mismatch: expected main, got feature/task-1");
	});
});
