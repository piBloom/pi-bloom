import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	assertCanonicalRepo,
	assertSupportedRebuildBranch,
	assertValidPrimaryUser,
	atomicWriteFile,
	ensureDir,
	getCanonicalRepoDir,
	getDaemonStateDir,
	getNixPiDir,
	getNixPiStateDir,
	getPersonaDonePath,
	getPiDir,
	getPrimaryUser,
	getQuadletDir,
	getSystemFlakeDir,
	getSystemReadyPath,
	getUpdateStatusPath,
	getWizardStateDir,
	readPackageVersion,
	resolvePackageDir,
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
		expect(() => getCanonicalRepoMetadataPath("../escape")).toThrow(
			"Invalid primary user for canonical repo path: ../escape",
		);
	});

	it("builds the canonical repo dir at /srv/nixpi", () => {
		expect(getCanonicalRepoDir()).toBe("/srv/nixpi");
	});

	it("builds the canonical repo metadata path under /etc/nixpi", () => {
		expect(getCanonicalRepoMetadataPath("alex")).toBe("/etc/nixpi/canonical-repo.json");
	});

	it("lets assertCanonicalRepo enforce the canonical path policy", () => {
		process.env.NIXPI_PRIMARY_USER = "alex";
		expect(() =>
			assertCanonicalRepo({
				path: "/tmp/pi-nixpi",
			}),
		).toThrow("Canonical repo path mismatch: expected /srv/nixpi, got /tmp/pi-nixpi");
	});

	it("rejects repos outside the canonical path", () => {
		expect(() =>
			assertCanonicalRepo({
				path: "/home/alex/.nixpi/pi-nixpi",
			}),
		).toThrow("Canonical repo path mismatch: expected /srv/nixpi, got /home/alex/.nixpi/pi-nixpi");
	});

	it("rejects repos with the wrong origin", () => {
		expect(() =>
			assertCanonicalRepo({
				path: "/srv/nixpi",
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
				path: "/srv/nixpi",
				origin: "https://github.com/alexradunet/nixpi.git",
			}),
		).toThrow("Canonical repo origin expectation missing");
	});

	it("rejects origin checks without an actual origin", () => {
		expect(() =>
			assertCanonicalRepo({
				path: "/srv/nixpi",
				expectedOrigin: "https://github.com/alexradunet/nixpi.git",
			}),
		).toThrow("Canonical repo origin actual value missing");
	});

	it("rejects repos on the wrong branch", () => {
		expect(() =>
			assertCanonicalRepo({
				path: "/srv/nixpi",
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
				path: "/srv/nixpi",
				branch: "main",
			}),
		).toThrow("Canonical repo branch expectation missing");
	});

	it("rejects branch checks without an actual branch", () => {
		expect(() =>
			assertCanonicalRepo({
				path: "/srv/nixpi",
				expectedBranch: "main",
			}),
		).toThrow("Canonical repo branch actual value missing");
	});

	it("rejects rebuild branches other than main", () => {
		expect(() => assertSupportedRebuildBranch("feature/test")).toThrow(
			"Supported rebuilds require /srv/nixpi to be on main",
		);
		expect(() => assertSupportedRebuildBranch("main")).not.toThrow();
	});
});

describe("canonical repo metadata", () => {
	let origPrimaryUser: string | undefined;
	let metadataPath: string;

	beforeEach(() => {
		vi.resetModules();
		origPrimaryUser = process.env.NIXPI_PRIMARY_USER;
		process.env.NIXPI_PRIMARY_USER = "codex-test-user";
		metadataPath = "/etc/nixpi/canonical-repo.json";
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
			path: "/srv/nixpi",
			origin: "https://github.com/example/nixpi.git",
			branch: "main",
		};

		const atomicWriteMock = vi.fn();
		vi.doMock("../../core/lib/filesystem.js", async () => {
			const actual =
				await vi.importActual<typeof import("../../core/lib/filesystem.js")>("../../core/lib/filesystem.js");
			return { ...actual, atomicWriteFile: atomicWriteMock };
		});
		const { writeCanonicalRepoMetadata } = await import("../../core/lib/repo-metadata.js");

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

	it("reads legacy firstboot metadata when canonical metadata has not been migrated yet", async () => {
		const legacyPath = "/home/codex-test-user/.nixpi/canonical-repo.json";
		const metadata = {
			path: "/srv/nixpi",
			origin: "https://github.com/example/nixpi.git",
			branch: "main",
		};

		vi.doMock("node:fs", async () => {
			const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
			return {
				...actual,
				existsSync: vi.fn((candidate: string) => candidate === legacyPath),
				readFileSync: vi.fn((candidate: string) => {
					if (candidate !== legacyPath) throw new Error(`unexpected path ${candidate}`);
					return JSON.stringify(metadata);
				}),
			};
		});
		vi.resetModules();
		const { readCanonicalRepoMetadata } = await import("../../core/lib/repo-metadata.js");

		expect(readCanonicalRepoMetadata("codex-test-user")).toEqual(metadata);
	});

	it("rejects malformed canonical repo metadata", async () => {
		vi.doMock("node:fs", async () => {
			const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
			return {
				...actual,
				existsSync: vi.fn().mockReturnValue(true),
				readFileSync: vi.fn().mockReturnValue(JSON.stringify({ path: "/srv/nixpi" })),
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
			const actual =
				await vi.importActual<typeof import("../../core/lib/filesystem.js")>("../../core/lib/filesystem.js");
			return { ...actual, atomicWriteFile: atomicWriteMock };
		});
		const { writeCanonicalRepoMetadata } = await import("../../core/lib/repo-metadata.js");

		expect(() =>
			writeCanonicalRepoMetadata(
				{
					path: "/home/alex/nixpi",
					origin: "https://github.com/example/nixpi.git",
					branch: "main",
				},
				"codex-test-user",
			),
		).toThrow("Invalid canonical repo metadata path: expected /srv/nixpi, got /home/alex/nixpi");
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
						path: "/home/alex/nixpi",
						origin: "https://github.com/example/nixpi.git",
						branch: "main",
					}),
				),
			};
		});
		const { readCanonicalRepoMetadata } = await import("../../core/lib/repo-metadata.js");

		expect(() => readCanonicalRepoMetadata("codex-test-user")).toThrow(
			"Invalid canonical repo metadata path: expected /srv/nixpi, got /home/alex/nixpi",
		);
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
	let origDaemonDir: string | undefined;

	beforeEach(() => {
		origStateDir = process.env.NIXPI_STATE_DIR;
		origPiDir = process.env.NIXPI_PI_DIR;
		origDaemonDir = process.env.NIXPI_DAEMON_STATE_DIR;
	});

	afterEach(() => {
		if (origStateDir !== undefined) process.env.NIXPI_STATE_DIR = origStateDir;
		else delete process.env.NIXPI_STATE_DIR;
		if (origPiDir !== undefined) process.env.NIXPI_PI_DIR = origPiDir;
		else delete process.env.NIXPI_PI_DIR;
		if (origDaemonDir !== undefined) process.env.NIXPI_DAEMON_STATE_DIR = origDaemonDir;
		else delete process.env.NIXPI_DAEMON_STATE_DIR;
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

	it("getWizardStateDir is nested under getNixPiStateDir", () => {
		process.env.NIXPI_STATE_DIR = "/s";
		expect(getWizardStateDir()).toBe("/s/wizard-state");
	});

	it("getSystemReadyPath is inside wizard-state", () => {
		process.env.NIXPI_STATE_DIR = "/s";
		expect(getSystemReadyPath()).toBe("/s/wizard-state/system-ready");
	});

	it("getPersonaDonePath is inside wizard-state", () => {
		process.env.NIXPI_STATE_DIR = "/s";
		expect(getPersonaDonePath()).toBe("/s/wizard-state/persona-done");
	});

	it("getUpdateStatusPath is inside state dir", () => {
		process.env.NIXPI_STATE_DIR = "/s";
		expect(getUpdateStatusPath()).toBe("/s/update-status.json");
	});

	it("getDaemonStateDir returns NIXPI_DAEMON_STATE_DIR env or fallback under getPiDir", () => {
		process.env.NIXPI_DAEMON_STATE_DIR = "/custom/daemon";
		expect(getDaemonStateDir()).toBe("/custom/daemon");
		delete process.env.NIXPI_DAEMON_STATE_DIR;
		process.env.NIXPI_PI_DIR = "/pi";
		expect(getDaemonStateDir()).toBe("/pi/nixpi-daemon");
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
