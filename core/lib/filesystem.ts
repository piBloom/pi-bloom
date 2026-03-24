/** Safe filesystem operations: path traversal protection, temp dirs, and home resolution. */
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface CanonicalRepoValidationArgs {
	path?: string;
	origin?: string;
	branch?: string;
	expectedPath?: string;
	expectedOrigin?: string;
	expectedBranch?: string;
	actualPath?: string;
	actualOrigin?: string;
	actualBranch?: string;
}

/** Ensure a directory exists. */
export function ensureDir(dir: string, mode?: number): void {
	if (existsSync(dir)) return;
	mkdirSync(dir, { recursive: true, ...(mode ? { mode } : {}) });
}

/** Write a file atomically via temporary sibling + rename. */
export function atomicWriteFile(filePath: string, content: string, mode?: number): void {
	ensureDir(path.dirname(filePath), mode);
	const tmpPath = `${filePath}.tmp`;
	writeFileSync(tmpPath, content, "utf-8");
	renameSync(tmpPath, filePath);
}

/**
 * Resolve a path under a root directory and reject traversal, including
 * escaping through existing symlinks.
 */
export function safePathWithin(root: string, ...segments: string[]): string {
	const resolvedRoot = path.resolve(root);
	const resolvedPath = path.resolve(resolvedRoot, ...segments);
	if (segments.length === 0) return resolvedRoot;

	if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
		throw new Error(`Path traversal blocked: ${segments.join("/")} escapes ${root}`);
	}

	const existingRoot = existsSync(resolvedRoot) ? realpathSync(resolvedRoot) : resolvedRoot;
	const existingParent = existsSync(path.dirname(resolvedPath))
		? realpathSync(path.dirname(resolvedPath))
		: path.dirname(resolvedPath);
	const existingTarget = existsSync(resolvedPath) ? realpathSync(resolvedPath) : resolvedPath;

	for (const candidate of [existingParent, existingTarget]) {
		if (candidate !== existingRoot && !candidate.startsWith(`${existingRoot}${path.sep}`)) {
			throw new Error(`Path traversal blocked: ${segments.join("/")} escapes ${root}`);
		}
	}

	return resolvedPath;
}

/**
 * Resolve path segments under a root directory, blocking path traversal.
 * Throws if the resolved path escapes the root.
 */
export function safePath(root: string, ...segments: string[]): string {
	return safePathWithin(root, ...segments);
}

/** Resolve the configured app data directory. Checks `NIXPI_DIR`, then falls back to `~/nixpi`. */
export function getNixPiDir(): string {
	return process.env.NIXPI_DIR ?? path.join(os.homedir(), "nixpi");
}

/** Resolve the NixPI state directory under the user's home. */
export function getNixPiStateDir(): string {
	return process.env.NIXPI_STATE_DIR ?? path.join(os.homedir(), ".nixpi");
}

/** Resolve the configured Pi runtime directory. */
export function getPiDir(): string {
	return process.env.NIXPI_PI_DIR ?? path.join(os.homedir(), ".pi");
}

/** Resolve the persisted wizard checkpoint directory. */
export function getWizardStateDir(): string {
	return path.join(getNixPiStateDir(), "wizard-state");
}

/** Resolve the system-ready marker path. */
export function getSystemReadyPath(): string {
	return path.join(getWizardStateDir(), "system-ready");
}

/** Resolve the primary account name used for the canonical repo checkout. */
export function assertValidPrimaryUser(primaryUser: string): string {
	if (!/^[a-z_][a-z0-9_-]*[$]?$/i.test(primaryUser)) {
		throw new Error(`Invalid primary user for canonical repo path: ${primaryUser}`);
	}
	return primaryUser;
}

/** Resolve the primary account name used for the canonical repo checkout. */
export function getPrimaryUser(): string {
	const envPrimaryUser = process.env.NIXPI_PRIMARY_USER;
	if (envPrimaryUser) return assertValidPrimaryUser(envPrimaryUser);

	const currentUser = os.userInfo().username;
	if (currentUser === "root") {
		throw new Error("NIXPI_PRIMARY_USER is required when resolving canonical repo paths as root");
	}

	return assertValidPrimaryUser(currentUser);
}

/** Resolve the canonical working repo path for the primary user. */
export function getCanonicalRepoDir(primaryUser = getPrimaryUser()): string {
	return path.join("/home", assertValidPrimaryUser(primaryUser), "nixpi");
}

/** Resolve the persona-complete marker path. */
export function getPersonaDonePath(): string {
	return path.join(getWizardStateDir(), "persona-done");
}

/** Path to the user's Quadlet unit directory for rootless containers. */
export function getQuadletDir(): string {
	return path.join(os.homedir(), ".config", "containers", "systemd");
}

/** Path to the OS update status file written by the update-check timer. */
export function getUpdateStatusPath(): string {
	return path.join(getNixPiStateDir(), "update-status.json");
}

/** Path to the canonical system flake checkout used for rebuilds. */
export function getSystemFlakeDir(): string {
	return process.env.NIXPI_SYSTEM_FLAKE_DIR ?? getCanonicalRepoDir();
}

/** Resolve the dedicated daemon state directory. */
export function getDaemonStateDir(): string {
	return process.env.NIXPI_DAEMON_STATE_DIR ?? path.join(getPiDir(), "nixpi-daemon");
}

/** Path to the local repo clone used for local-only proposal workflows. */
export function getNixPiRepoDir(): string {
	return getCanonicalRepoDir();
}

function getExpectedCanonicalRepoValues(args: CanonicalRepoValidationArgs) {
	return {
		expectedPath: args.expectedPath ?? getCanonicalRepoDir(),
		expectedOrigin: args.expectedOrigin,
		expectedBranch: args.expectedBranch,
		actualPath: args.actualPath ?? args.path,
		actualOrigin: args.actualOrigin ?? args.origin,
		actualBranch: args.actualBranch ?? args.branch,
	};
}

/** Validate repo path, origin, and branch against the canonical policy. */
export function assertCanonicalRepo(args: CanonicalRepoValidationArgs): void {
	const { expectedPath, expectedOrigin, expectedBranch, actualPath, actualOrigin, actualBranch } =
		getExpectedCanonicalRepoValues(args);

	if (actualPath !== expectedPath) {
		throw new Error(`Canonical repo path mismatch: expected ${expectedPath}, got ${actualPath ?? "(missing)"}`);
	}
	if (actualOrigin !== undefined && expectedOrigin === undefined) {
		throw new Error("Canonical repo origin expectation missing");
	}
	if (expectedOrigin !== undefined && actualOrigin === undefined) {
		throw new Error("Canonical repo origin actual value missing");
	}
	if (expectedOrigin !== undefined && actualOrigin !== expectedOrigin) {
		throw new Error(
			`Canonical repo origin mismatch: expected ${expectedOrigin ?? "(missing)"}, got ${actualOrigin ?? "(missing)"}`,
		);
	}
	if (actualBranch !== undefined && expectedBranch === undefined) {
		throw new Error("Canonical repo branch expectation missing");
	}
	if (expectedBranch !== undefined && actualBranch === undefined) {
		throw new Error("Canonical repo branch actual value missing");
	}
	if (expectedBranch !== undefined && actualBranch !== expectedBranch) {
		throw new Error(
			`Canonical repo branch mismatch: expected ${expectedBranch ?? "(missing)"}, got ${actualBranch ?? "(missing)"}`,
		);
	}
}

/** Backward-compatible alias for canonical repo policy checks. */
export function validateCanonicalRepo(args: CanonicalRepoValidationArgs): void {
	assertCanonicalRepo(args);
}

/** Resolve the package root by walking up from the current module URL. */
export function resolvePackageDir(moduleUrl: string, maxDepth = 6): string {
	let dir = path.dirname(fileURLToPath(moduleUrl));
	for (let i = 0; i < maxDepth; i += 1) {
		if (existsSync(path.join(dir, "package.json"))) return dir;
		dir = path.dirname(dir);
	}
	return process.cwd();
}

/** Read the package version from a package root, defaulting to 0.1.0. */
export function readPackageVersion(packageDir: string): string {
	try {
		const pkg = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf-8")) as {
			version?: string;
		};
		return pkg.version ?? "0.1.0";
	} catch {
		return "0.1.0";
	}
}
