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
import { yaml } from "./frontmatter.js";
import { createLogger } from "./shared.js";

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
	image?: string;
	optional?: boolean;
	depends?: string[];
	models?: Array<{
		volume: string;
		path: string;
		url: string;
	}>;
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
	_name: string,
	entry: ServiceCatalogEntry | undefined,
	signal?: AbortSignal,
): Promise<string[]> {
	const errors: string[] = [];
	const commands = entry?.preflight?.commands ?? ["podman", "systemctl"];
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

/** Install a service from a bundled local package. Copies Quadlet files, SKILL.md, and generates channel tokens. */
export async function installServicePackage(
	name: string,
	_version: string,
	bloomDir: string,
	repoDir: string,
	_entry: ServiceCatalogEntry | undefined,
	signal?: AbortSignal,
): Promise<{ ok: boolean; source: "local"; ref: string; note?: string }> {
	const localPackage = findLocalServicePackage(name, repoDir);
	if (!localPackage) {
		return {
			ok: false,
			source: "local",
			ref: name,
			note: `No local service package found for ${name}. Searched repo dir, /usr/local/share/bloom, and cwd.`,
		};
	}

	const tempDir = mkdtempSync(join(os.tmpdir(), `bloom-manifest-${name}-`));

	try {
		const localTempQuadlet = join(tempDir, "quadlet");
		mkdirSync(localTempQuadlet, { recursive: true });
		for (const fileName of readdirSync(localPackage.quadletDir)) {
			const src = join(localPackage.quadletDir, fileName);
			if (!statSync(src).isFile()) continue;
			writeFileSync(join(localTempQuadlet, fileName), readFileSync(src));
		}
		writeFileSync(join(tempDir, "SKILL.md"), readFileSync(localPackage.skillPath));

		const quadletSrc = join(tempDir, "quadlet");
		const skillSrc = join(tempDir, "SKILL.md");
		if (!existsSync(quadletSrc) || !existsSync(skillSrc)) {
			return {
				ok: false,
				source: "local",
				ref: name,
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

		return { ok: true, source: "local", ref: name };
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

// ---------------------------------------------------------------------------
// Local image builds & model downloads
// ---------------------------------------------------------------------------

/** Build a local container image if the image ref starts with localhost/. */
export async function buildLocalImage(
	name: string,
	image: string,
	repoDir: string,
	signal?: AbortSignal,
): Promise<{ ok: boolean; skipped: boolean; note?: string }> {
	if (!image.startsWith("localhost/")) {
		return { ok: true, skipped: true };
	}

	// Check if image already exists
	const exists = await run("podman", ["image", "exists", image], signal);
	if (exists.exitCode === 0) {
		return { ok: true, skipped: true, note: "image already exists" };
	}

	// Find service source directory with a Containerfile
	const candidates = [join(repoDir, "services", name), `/usr/local/share/bloom/services/${name}`];
	let serviceDir: string | null = null;
	for (const candidate of candidates) {
		if (existsSync(join(candidate, "Containerfile"))) {
			serviceDir = candidate;
			break;
		}
	}
	if (!serviceDir) {
		return { ok: false, skipped: false, note: `Service source with Containerfile not found for ${name}` };
	}

	// Build in a temp directory: npm install, npm run build, podman build
	const buildDir = mkdtempSync(join(os.tmpdir(), `bloom-build-${name}-`));
	try {
		// Copy source to build dir
		const cpResult = await run("cp", ["-a", `${serviceDir}/.`, buildDir], signal);
		if (cpResult.exitCode !== 0) {
			return { ok: false, skipped: false, note: `Failed to copy source: ${cpResult.stderr}` };
		}

		// npm install + build if package.json exists
		if (existsSync(join(buildDir, "package.json"))) {
			const npmInstall = await run("npm", ["install"], signal, buildDir);
			if (npmInstall.exitCode !== 0) {
				return { ok: false, skipped: false, note: `npm install failed: ${npmInstall.stderr}` };
			}
			const npmBuild = await run("npm", ["run", "build"], signal, buildDir);
			if (npmBuild.exitCode !== 0) {
				return { ok: false, skipped: false, note: `npm run build failed: ${npmBuild.stderr}` };
			}
		}

		// podman build — use full image reference as tag so it matches `podman image exists` checks
		const podmanBuild = await run("podman", ["build", "-t", image, "-f", "Containerfile", "."], signal, buildDir);
		if (podmanBuild.exitCode !== 0) {
			return { ok: false, skipped: false, note: `podman build failed: ${podmanBuild.stderr}` };
		}

		return { ok: true, skipped: false };
	} finally {
		rmSync(buildDir, { recursive: true, force: true });
	}
}

/** Download required models for a service if not already present in volumes. */
export async function downloadServiceModels(
	models: Array<{ volume: string; path: string; url: string }>,
	signal?: AbortSignal,
): Promise<{ ok: boolean; downloaded: number; note?: string }> {
	let downloaded = 0;

	for (const model of models) {
		// Ensure volume exists
		const volCheck = await run("podman", ["volume", "inspect", model.volume], signal);
		if (volCheck.exitCode !== 0) {
			await run("podman", ["volume", "create", model.volume], signal);
		}

		// Check if model file already exists in volume
		const filename = model.path.split("/").pop() ?? "model";
		const fileCheck = await run(
			"podman",
			[
				"run",
				"--rm",
				"-v",
				`${model.volume}:/models:ro`,
				"docker.io/library/busybox:latest",
				"test",
				"-f",
				`/models/${filename}`,
			],
			signal,
		);
		if (fileCheck.exitCode === 0) continue;

		// Download model into volume
		const dlResult = await run(
			"podman",
			[
				"run",
				"--rm",
				"-v",
				`${model.volume}:/models`,
				"docker.io/curlimages/curl:latest",
				"-L",
				"-o",
				`/models/${filename}`,
				model.url,
			],
			signal,
		);
		if (dlResult.exitCode !== 0) {
			return { ok: false, downloaded, note: `Failed to download model ${filename}: ${dlResult.stderr}` };
		}
		downloaded++;
	}

	return { ok: true, downloaded };
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

// ---------------------------------------------------------------------------
// Service validation helpers (merged from service-utils.ts)
// ---------------------------------------------------------------------------

/** Validate that a service name is kebab-case `[a-z0-9-]`. Returns error message or null. */
export function validateServiceName(name: string): string | null {
	if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
		return "Service name must be kebab-case using [a-z0-9-].";
	}
	return null;
}

/** Validate that a container image reference is pinned (digest or explicit non-latest tag). Returns error message or null. */
export function validatePinnedImage(image: string): string | null {
	if (image.includes("@sha256:")) return null;
	const tagMatch = image.match(/:([^/@]+)$/);
	if (!tagMatch) {
		return "Image must include an explicit version tag or digest (avoid implicit latest).";
	}
	const tag = tagMatch[1].toLowerCase();
	if (tag === "latest" || tag.startsWith("latest-")) {
		return "Image tag must be pinned (avoid latest/latest-* tags).";
	}
	return null;
}

/** Check if an error message indicates a missing command (ENOENT, not found, etc.). */
export function commandMissingError(text: string): boolean {
	return /ENOENT|not found|No such file/i.test(text);
}
