import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as filesystemModule from "../../core/lib/filesystem.js";
import {
	assertCanonicalRepo,
	assertValidPrimaryUser,
	getCanonicalRepoDir,
	getNixPiDir,
	getNixPiRepoDir,
	getPrimaryUser,
	getSystemFlakeDir,
	safePath,
	validateCanonicalRepo,
} from "../../core/lib/filesystem.js";
import {
	getCanonicalRepoMetadataPath,
	readCanonicalRepoMetadata,
	writeCanonicalRepoMetadata,
} from "../../core/lib/repo-metadata.js";

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

	it("defaults to the canonical ~/nixpi checkout", () => {
		delete process.env.NIXPI_SYSTEM_FLAKE_DIR;
		delete process.env.NIXPI_DIR;
		expect(getSystemFlakeDir()).toBe("/home/alex/nixpi");
	});

	it("stays aligned with the canonical repo even when NIXPI_DIR is set", () => {
		delete process.env.NIXPI_SYSTEM_FLAKE_DIR;
		process.env.NIXPI_DIR = "/workspace/nixpi";
		expect(getSystemFlakeDir()).toBe("/home/alex/nixpi");
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

		expect(() => getPrimaryUser()).toThrow("NIXPI_PRIMARY_USER is required when resolving canonical repo paths as root");

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
		expect(() => getCanonicalRepoDir("../escape")).toThrow(
			"Invalid primary user for canonical repo path: ../escape",
		);
		expect(() => getCanonicalRepoMetadataPath("../escape")).toThrow(
			"Invalid primary user for canonical repo path: ../escape",
		);
	});

	it("builds the canonical repo dir under /home/<primaryUser>/nixpi", () => {
		expect(getCanonicalRepoDir("alex")).toBe("/home/alex/nixpi");
	});

	it("defaults the repo dir to /home/<primaryUser>/nixpi", () => {
		process.env.NIXPI_PRIMARY_USER = "alex";
		expect(getNixPiRepoDir()).toBe("/home/alex/nixpi");
	});

	it("ignores NIXPI_REPO_DIR overrides and stays canonical", () => {
		process.env.NIXPI_PRIMARY_USER = "alex";
		process.env.NIXPI_REPO_DIR = "/tmp/pi-nixpi";
		expect(getNixPiRepoDir()).toBe("/home/alex/nixpi");
	});

	it("builds the canonical repo metadata path under /home/<primaryUser>/.nixpi", () => {
		expect(getCanonicalRepoMetadataPath("alex")).toBe("/home/alex/.nixpi/canonical-repo.json");
	});

	it("lets validateCanonicalRepo enforce the canonical path policy", () => {
		process.env.NIXPI_PRIMARY_USER = "alex";
		expect(() =>
			validateCanonicalRepo({
				path: "/tmp/pi-nixpi",
			}),
		).toThrow("Canonical repo path mismatch: expected /home/alex/nixpi, got /tmp/pi-nixpi");
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

	it("rejects origin checks without an expected origin", () => {
		expect(() =>
			assertCanonicalRepo({
				path: "/home/alex/nixpi",
				origin: "https://github.com/alexradunet/nixpi.git",
			}),
		).toThrow("Canonical repo origin expectation missing");
	});

	it("rejects origin checks without an actual origin", () => {
		expect(() =>
			assertCanonicalRepo({
				path: "/home/alex/nixpi",
				expectedOrigin: "https://github.com/alexradunet/nixpi.git",
			}),
		).toThrow("Canonical repo origin actual value missing");
	});

	it("rejects repos on the wrong branch", () => {
		expect(() =>
			assertCanonicalRepo({
				path: "/home/alex/nixpi",
				origin: "https://github.com/alexradunet/nixpi.git",
				branch: "feature/task-1",
				expectedOrigin: "https://github.com/alexradunet/nixpi.git",
				expectedBranch: "main",
			}),
		).toThrow("Canonical repo branch mismatch: expected main, got feature/task-1");
	});

	it("rejects branch checks without an expected branch", () => {
		expect(() =>
			assertCanonicalRepo({
				path: "/home/alex/nixpi",
				branch: "main",
			}),
		).toThrow("Canonical repo branch expectation missing");
	});

	it("rejects branch checks without an actual branch", () => {
		expect(() =>
			assertCanonicalRepo({
				path: "/home/alex/nixpi",
				expectedBranch: "main",
			}),
		).toThrow("Canonical repo branch actual value missing");
	});
});

describe("canonical repo metadata", () => {
	let origPrimaryUser: string | undefined;
	let metadataPath: string;

	beforeEach(() => {
		vi.resetModules();
		origPrimaryUser = process.env.NIXPI_PRIMARY_USER;
		process.env.NIXPI_PRIMARY_USER = "codex-test-user";
		metadataPath = "/home/codex-test-user/.nixpi/canonical-repo.json";
	});

	afterEach(() => {
		if (origPrimaryUser !== undefined) {
			process.env.NIXPI_PRIMARY_USER = origPrimaryUser;
		} else {
			delete process.env.NIXPI_PRIMARY_USER;
		}
		vi.doUnmock("node:fs");
		vi.doUnmock("../../core/lib/filesystem.js");
		vi.restoreAllMocks();
	});

	it("writes and reads canonical repo metadata via the shared API", async () => {
		const metadata = {
			path: "/home/codex-test-user/nixpi",
			origin: "https://github.com/example/nixpi.git",
			branch: "main",
		};

		const atomicWriteMock = vi.fn();
		vi.doMock("../../core/lib/filesystem.js", async () => {
			const actual = await vi.importActual<typeof import("../../core/lib/filesystem.js")>(
				"../../core/lib/filesystem.js",
			);
			return { ...actual, atomicWriteFile: atomicWriteMock };
		});
		const { writeCanonicalRepoMetadata, readCanonicalRepoMetadata } = await import("../../core/lib/repo-metadata.js");

		const writtenPath = writeCanonicalRepoMetadata(metadata, "codex-test-user");

		expect(writtenPath).toBe(metadataPath);
		expect(atomicWriteMock).toHaveBeenCalledWith(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);

		vi.doMock("node:fs", async () => {
			const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
			return {
				...actual,
				existsSync: vi.fn().mockReturnValue(true),
				readFileSync: vi.fn().mockReturnValue(JSON.stringify(metadata)),
			};
		});
		vi.resetModules();
		const reloaded = await import("../../core/lib/repo-metadata.js");
		expect(reloaded.readCanonicalRepoMetadata("codex-test-user")).toEqual(metadata);
	});

	it("returns undefined when canonical repo metadata is absent", async () => {
		vi.doMock("node:fs", async () => {
			const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
			return { ...actual, existsSync: vi.fn().mockReturnValue(false) };
		});
		const { readCanonicalRepoMetadata } = await import("../../core/lib/repo-metadata.js");
		expect(readCanonicalRepoMetadata("codex-test-user")).toBeUndefined();
	});

	it("rejects malformed canonical repo metadata", async () => {
		vi.doMock("node:fs", async () => {
			const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
			return {
				...actual,
				existsSync: vi.fn().mockReturnValue(true),
				readFileSync: vi.fn().mockReturnValue(JSON.stringify({ path: "/home/codex-test-user/nixpi" })),
			};
		});
		const { readCanonicalRepoMetadata } = await import("../../core/lib/repo-metadata.js");

		expect(() => readCanonicalRepoMetadata("codex-test-user")).toThrow(
			`Invalid canonical repo metadata in ${metadataPath}`,
		);
	});

	it("rejects writing canonical repo metadata with a non-canonical path", async () => {
		const atomicWriteMock = vi.fn();
		vi.doMock("../../core/lib/filesystem.js", async () => {
			const actual = await vi.importActual<typeof import("../../core/lib/filesystem.js")>(
				"../../core/lib/filesystem.js",
			);
			return { ...actual, atomicWriteFile: atomicWriteMock };
		});
		const { writeCanonicalRepoMetadata } = await import("../../core/lib/repo-metadata.js");

		expect(() =>
			writeCanonicalRepoMetadata({
				path: "/tmp/pi-nixpi",
				origin: "https://github.com/example/nixpi.git",
				branch: "main",
			}, "codex-test-user"),
		).toThrow("Invalid canonical repo metadata path: expected /home/codex-test-user/nixpi, got /tmp/pi-nixpi");
		expect(atomicWriteMock).not.toHaveBeenCalled();
	});

	it("rejects reading canonical repo metadata with a non-canonical path", async () => {
		vi.doMock("node:fs", async () => {
			const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
			return {
				...actual,
				existsSync: vi.fn().mockReturnValue(true),
				readFileSync: vi.fn().mockReturnValue(
					JSON.stringify({
						path: "/tmp/pi-nixpi",
						origin: "https://github.com/example/nixpi.git",
						branch: "main",
					}),
				),
			};
		});
		const { readCanonicalRepoMetadata } = await import("../../core/lib/repo-metadata.js");

		expect(() => readCanonicalRepoMetadata("codex-test-user")).toThrow(
			"Invalid canonical repo metadata path: expected /home/codex-test-user/nixpi, got /tmp/pi-nixpi",
		);
	});
});
