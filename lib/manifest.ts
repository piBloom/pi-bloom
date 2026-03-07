import { randomBytes } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { run } from "./exec.js";
import { commandMissingError } from "./service-utils.js";
import { createLogger, yaml } from "./shared.js";

/**
 * Check whether a `/etc/subuid` or `/etc/subgid` file contains an entry
 * for the given username.
 *
 * Each line in these files has the format `username:start:count`.
 * Returns `true` if any line starts with `username:`.
 *
 * @param filePath - Path to the subid file (e.g. `/etc/subuid`).
 * @param username - OS username to look for.
 * @returns `true` if the user has a subordinate ID range in the file.
 */
export function hasSubidRange(filePath: string, username: string): boolean {
	if (!existsSync(filePath)) return false;
	try {
		return readFileSync(filePath, "utf-8")
			.split("\n")
			.some((line) => line.trim().startsWith(`${username}:`));
	} catch {
		return false;
	}
}

const log = createLogger("manifest");

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** A single service entry inside a Bloom manifest. */
export interface ManifestService {
	image: string;
	version?: string;
	enabled: boolean;
}

/** Declarative service manifest stored at `~/Bloom/manifest.yaml`. */
export interface Manifest {
	device?: string;
	os_image?: string;
	services: Record<string, ManifestService>;
}

/** Entry for one service in the service catalog (`services/catalog.yaml`). */
export interface ServiceCatalogEntry {
	version?: string;
	category?: string;
	artifact?: string;
	image?: string;
	optional?: boolean;
	preflight?: {
		commands?: string[];
		rootless_subids?: boolean;
	};
}

// ---------------------------------------------------------------------------
// Manifest I/O
// ---------------------------------------------------------------------------

/** Load the manifest from disk. Returns an empty manifest if the file is missing or invalid. */
export function loadManifest(manifestPath: string): Manifest {
	if (!existsSync(manifestPath)) return { services: {} };
	try {
		const raw = readFileSync(manifestPath, "utf-8");
		const doc = yaml.load(raw) as Manifest | null;
		return doc ?? { services: {} };
	} catch (err) {
		log.warn("failed to load manifest", { error: (err as Error).message });
		return { services: {} };
	}
}

/** Write the manifest to disk, creating the parent directory if needed. */
export function saveManifest(manifest: Manifest, manifestPath: string): void {
	mkdirSync(dirname(manifestPath), { recursive: true });
	writeFileSync(manifestPath, yaml.dump(manifest));
}

// ---------------------------------------------------------------------------
// Service catalog
// ---------------------------------------------------------------------------

/** Load the service catalog from the first location that exists among repo dir, system share, and cwd. */
export function loadServiceCatalog(repoDir: string): Record<string, ServiceCatalogEntry> {
	const candidates = [
		join(repoDir, "services", "catalog.yaml"),
		"/usr/local/share/bloom/services/catalog.yaml",
		join(process.cwd(), "services", "catalog.yaml"),
	];
	for (const candidate of candidates) {
		if (!existsSync(candidate)) continue;
		try {
			const raw = readFileSync(candidate, "utf-8");
			const doc = (yaml.load(raw) as { services?: Record<string, ServiceCatalogEntry> } | null) ?? {};
			if (doc.services && typeof doc.services === "object") return doc.services;
		} catch {
			// ignore and continue
		}
	}
	return {};
}

// ---------------------------------------------------------------------------
// Command / preflight helpers
// ---------------------------------------------------------------------------

/** Return the arguments used to verify a command exists (e.g. `["--version"]`). */
export function commandCheckArgs(cmd: string): string[] {
	switch (cmd) {
		case "oras":
			return ["version"];
		case "podman":
		case "systemctl":
			return ["--version"];
		default:
			return ["--version"];
	}
}

/** Check whether a CLI command is available on this system. */
export async function commandExists(cmd: string, signal?: AbortSignal): Promise<boolean> {
	if (!/^[a-zA-Z0-9._+-]+$/.test(cmd)) return false;
	const check = await run(cmd, commandCheckArgs(cmd), signal);
	if (check.exitCode === 0) return true;
	return !commandMissingError(check.stderr || check.stdout);
}

/** Run preflight checks for a service, returning a list of human-readable errors (empty = OK). */
export async function servicePreflightErrors(
	name: string,
	entry: ServiceCatalogEntry | undefined,
	signal?: AbortSignal,
): Promise<string[]> {
	const errors: string[] = [];
	const commands = entry?.preflight?.commands ?? ["oras", "podman", "systemctl"];
	for (const command of commands) {
		const ok = await commandExists(command, signal);
		if (!ok) errors.push(`missing command: ${command}`);
	}

	const needsSubids = entry?.preflight?.rootless_subids === true;
	if (needsSubids) {
		const user = os.userInfo().username;
		const hasSubuid = hasSubidRange("/etc/subuid", user);
		const hasSubgid = hasSubidRange("/etc/subgid", user);
		if (!hasSubuid || !hasSubgid) {
			errors.push(
				`rootless subuid/subgid mappings missing for ${user} (fix: sudo usermod --add-subuids 100000-165535 ${user} && sudo usermod --add-subgids 100000-165535 ${user})`,
			);
		}
	}

	return errors;
}

// ---------------------------------------------------------------------------
// Ref / auth helpers
// ---------------------------------------------------------------------------

/** Check whether a container image reference includes a tag or digest. */
export function hasTagOrDigest(ref: string): boolean {
	if (ref.includes("@")) return true;
	const lastSlash = ref.lastIndexOf("/");
	const tail = ref.slice(lastSlash + 1);
	return tail.includes(":");
}

// ---------------------------------------------------------------------------
// Service package installation
// ---------------------------------------------------------------------------

/** Find a bundled service package on disk (repo, system share, or cwd). Returns paths or null. */
export function findLocalServicePackage(
	name: string,
	repoDir: string,
): { serviceDir: string; quadletDir: string; skillPath: string } | null {
	const candidates = [
		join(repoDir, "services", name),
		`/usr/local/share/bloom/services/${name}`,
		join(process.cwd(), "services", name),
	];
	for (const serviceDir of candidates) {
		const quadletDir = join(serviceDir, "quadlet");
		const skillPath = join(serviceDir, "SKILL.md");
		if (existsSync(quadletDir) && existsSync(skillPath)) {
			return { serviceDir, quadletDir, skillPath };
		}
	}
	return null;
}

/** Pull a service package (OCI or local fallback), install Quadlet files, SKILL.md, and channel tokens. */
export async function installServicePackage(
	name: string,
	version: string,
	registry: string,
	bloomDir: string,
	repoDir: string,
	entry: ServiceCatalogEntry | undefined,
	signal?: AbortSignal,
): Promise<{ ok: boolean; source: "oci" | "local"; ref: string; note?: string }> {
	const artifactBase = entry?.artifact?.trim() || `${registry}/bloom-svc-${name}`;
	const ref = hasTagOrDigest(artifactBase) ? artifactBase : `${artifactBase}:${version}`;
	const tempDir = mkdtempSync(join(os.tmpdir(), `bloom-manifest-${name}-`));

	try {
		let source: "oci" | "local" = "oci";
		const pull = await run("oras", ["pull", ref, "-o", tempDir], signal);
		if (pull.exitCode !== 0) {
			const localPackage = findLocalServicePackage(name, repoDir);
			if (!localPackage) {
				return {
					ok: false,
					source,
					ref,
					note: `Failed to pull ${ref}: ${pull.stderr || pull.stdout}`,
				};
			}

			const localTempQuadlet = join(tempDir, "quadlet");
			mkdirSync(localTempQuadlet, { recursive: true });
			for (const fileName of readdirSync(localPackage.quadletDir)) {
				const src = join(localPackage.quadletDir, fileName);
				if (!statSync(src).isFile()) continue;
				writeFileSync(join(localTempQuadlet, fileName), readFileSync(src));
			}
			writeFileSync(join(tempDir, "SKILL.md"), readFileSync(localPackage.skillPath));
			source = "local";
		}

		const quadletSrc = join(tempDir, "quadlet");
		const skillSrc = join(tempDir, "SKILL.md");
		if (!existsSync(quadletSrc) || !existsSync(skillSrc)) {
			return {
				ok: false,
				source,
				ref,
				note: `Service package for ${name} missing quadlet/ or SKILL.md`,
			};
		}

		const systemdDir = join(os.homedir(), ".config", "containers", "systemd");
		const userSystemdDir = join(os.homedir(), ".config", "systemd", "user");
		const skillDir = join(bloomDir, "Skills", name);
		mkdirSync(systemdDir, { recursive: true });
		mkdirSync(userSystemdDir, { recursive: true });
		mkdirSync(skillDir, { recursive: true });

		const networkDest = join(systemdDir, "bloom.network");
		if (!existsSync(networkDest)) {
			const networkCandidates = [
				"/usr/share/containers/systemd/bloom.network",
				"/usr/local/share/bloom/os/sysconfig/bloom.network",
				join(repoDir, "os", "sysconfig", "bloom.network"),
			];
			for (const candidate of networkCandidates) {
				if (!existsSync(candidate)) continue;
				writeFileSync(networkDest, readFileSync(candidate));
				break;
			}
		}

		for (const fileName of readdirSync(quadletSrc)) {
			const src = join(quadletSrc, fileName);
			if (!statSync(src).isFile()) continue;
			const destDir = fileName.endsWith(".socket") ? userSystemdDir : systemdDir;
			writeFileSync(join(destDir, fileName), readFileSync(src));
		}
		writeFileSync(join(skillDir, "SKILL.md"), readFileSync(skillSrc));

		const expectedSocket = join(quadletSrc, `bloom-${name}.socket`);
		const installedSocket = join(userSystemdDir, `bloom-${name}.socket`);
		if (!existsSync(expectedSocket) && existsSync(installedSocket)) {
			await run("systemctl", ["--user", "disable", "--now", `bloom-${name}.socket`], signal);
			rmSync(installedSocket, { force: true });
		}

		const tokenDir = join(os.homedir(), ".config", "bloom", "channel-tokens");
		mkdirSync(tokenDir, { recursive: true });
		const tokenPath = join(tokenDir, name);
		const tokenEnvPath = join(tokenDir, `${name}.env`);
		if (!existsSync(tokenPath)) {
			const token = randomBytes(32).toString("hex");
			writeFileSync(tokenPath, `${token}\n`);
			writeFileSync(tokenEnvPath, `BLOOM_CHANNEL_TOKEN=${token}\n`);
		}

		return { ok: true, source, ref };
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

// ---------------------------------------------------------------------------
// Runtime detection
// ---------------------------------------------------------------------------

/** Detect currently running bloom-* containers via podman. Returns a map of service name to image/state. */
export async function detectRunningServices(
	signal?: AbortSignal,
): Promise<Map<string, { image: string; state: string }>> {
	const result = await run("podman", ["ps", "-a", "--format", "json", "--filter", "name=bloom-"], signal);
	const detected = new Map<string, { image: string; state: string }>();
	if (result.exitCode !== 0) return detected;
	try {
		const containers = JSON.parse(result.stdout || "[]") as Array<{
			Names?: string[];
			Image?: string;
			State?: string;
		}>;
		for (const c of containers) {
			const name = (c.Names ?? [])[0]?.replace(/^bloom-/, "") ?? "";
			if (name) {
				detected.set(name, { image: c.Image ?? "unknown", state: c.State ?? "unknown" });
			}
		}
	} catch {
		// parse error
	}
	return detected;
}
