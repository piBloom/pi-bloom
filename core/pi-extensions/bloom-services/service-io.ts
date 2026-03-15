/** Service I/O operations — package installation, image builds, model downloads, runtime detection. */
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import { join, posix as posixPath } from "node:path";
import { run } from "../../lib/exec.js";
import { getQuadletDir } from "../../lib/filesystem.js";
import { writeServiceHomeRuntime } from "../../lib/service-home.js";
import { findLocalServicePackage } from "../../lib/services-catalog.js";

/** Install a service from a bundled local package. Copies Quadlet files, SKILL.md, and config files. */
export async function installServicePackage(
	name: string,
	bloomDir: string,
	repoDir: string,
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

	const systemdDir = getQuadletDir();
	const userSystemdDir = join(os.homedir(), ".config", "systemd", "user");
	const skillDir = join(bloomDir, "Skills", name);
	mkdirSync(systemdDir, { recursive: true });
	mkdirSync(userSystemdDir, { recursive: true });
	mkdirSync(skillDir, { recursive: true });

	// Copy quadlet files directly to their destinations
	for (const fileName of readdirSync(localPackage.quadletDir)) {
		const src = join(localPackage.quadletDir, fileName);
		if (!statSync(src).isFile()) continue;
		const destDir = fileName.endsWith(".socket") ? userSystemdDir : systemdDir;
		writeFileSync(join(destDir, fileName), readFileSync(src));
	}

	// Copy skill file
	writeFileSync(join(skillDir, "SKILL.md"), readFileSync(localPackage.skillPath));

	// Clean up stale socket unit if package no longer includes one
	const expectedSocket = join(localPackage.quadletDir, `bloom-${name}.socket`);
	const installedSocket = join(userSystemdDir, `bloom-${name}.socket`);
	if (!existsSync(expectedSocket) && existsSync(installedSocket)) {
		await run("systemctl", ["--user", "disable", "--now", `bloom-${name}.socket`], signal);
		rmSync(installedSocket, { force: true });
	}

	// Ensure service-specific env file exists so the container can start
	const configDir = join(os.homedir(), ".config", "bloom");
	mkdirSync(configDir, { recursive: true });
	const serviceEnvPath = join(configDir, `${name}.env`);
	if (!existsSync(serviceEnvPath)) {
		writeFileSync(serviceEnvPath, "");
	}

	if (name === "dufs") {
		mkdirSync(join(os.homedir(), "Public", "Bloom"), { recursive: true });
	}
	if (name === "cinny") {
		await writeCinnyRuntimeConfig(configDir, signal);
	}

	// Copy extra config files (e.g., cinny-config.json) from service package
	for (const fileName of readdirSync(localPackage.serviceDir)) {
		if (!fileName.endsWith(".json") && !fileName.endsWith(".toml")) continue;
		const src = join(localPackage.serviceDir, fileName);
		if (!statSync(src).isFile()) continue;
		const dest = join(configDir, fileName);
		if (!existsSync(dest)) {
			writeFileSync(dest, readFileSync(src));
		}
	}

	await writeServiceHomeRuntime(configDir, repoDir, signal);

	return { ok: true, source: "local", ref: name };
}

async function writeCinnyRuntimeConfig(configDir: string, signal?: AbortSignal): Promise<void> {
	const cinnyDir = join(configDir, "cinny");
	const wellKnownDir = join(cinnyDir, ".well-known", "matrix");
	mkdirSync(wellKnownDir, { recursive: true });

	const access = await resolveMeshMatrixAccess(signal);
	const homeserverList = [access.primaryMatrixUrl];
	if (access.fallbackMatrixUrl) homeserverList.push(access.fallbackMatrixUrl);

	writeFileSync(
		join(cinnyDir, "config.json"),
		JSON.stringify(
			{
				defaultHomeserver: 0,
				homeserverList,
				allowCustomHomeservers: true,
				hashRouter: {
					enabled: true,
				},
			},
			null,
			2,
		),
	);

	writeFileSync(
		join(wellKnownDir, "client"),
		JSON.stringify(
			{
				"m.homeserver": {
					base_url: access.primaryMatrixUrl,
					server_name: "bloom",
				},
			},
			null,
			2,
		),
	);

	writeFileSync(
		join(cinnyDir, "nginx.conf"),
		`server {
    listen 80;
    server_name _;

    root /app;
    index index.html;

    location = /config.json {
        add_header Cache-Control "no-store";
        try_files /config.json =404;
    }

    location = /.well-known/matrix/client {
        add_header Access-Control-Allow-Origin "*";
        add_header Cache-Control "no-store";
        default_type application/json;
        try_files /.well-known/matrix/client =404;
    }

    location / {
        try_files $uri /index.html;
    }
}
`,
	);
}

async function resolveMeshMatrixAccess(
	signal?: AbortSignal,
): Promise<{ primaryMatrixUrl: string; fallbackMatrixUrl?: string }> {
	const status = await run("netbird", ["status", "--json"], signal);
	if (status.exitCode === 0) {
		try {
			const parsed = JSON.parse(status.stdout) as { fqdn?: string; netbirdIp?: string };
			const fqdn = parsed.fqdn?.trim();
			const meshIp = parsed.netbirdIp?.split("/")[0]?.trim();
			if (fqdn) {
				return {
					primaryMatrixUrl: `http://${fqdn}:6167`,
					fallbackMatrixUrl: meshIp ? `http://${meshIp}:6167` : undefined,
				};
			}
			if (meshIp) {
				return { primaryMatrixUrl: `http://${meshIp}:6167` };
			}
		} catch {
			// Fall back to localhost below.
		}
	}

	return { primaryMatrixUrl: "http://localhost:6167" };
}

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

		// Always rebuild localhost/* images so iterative testing cannot silently reuse stale tags.
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
		const normalizedPath = normalizeModelPath(model.path);
		if (!normalizedPath) {
			return { ok: false, downloaded, note: `Invalid model path: ${model.path}` };
		}

		// Ensure volume exists
		const volCheck = await run("podman", ["volume", "inspect", model.volume], signal);
		if (volCheck.exitCode !== 0) {
			await run("podman", ["volume", "create", model.volume], signal);
		}

		// Check if model file already exists in volume
		const filename = posixPath.basename(normalizedPath);
		const fileCheck = await run(
			"podman",
			[
				"run",
				"--rm",
				"-v",
				`${model.volume}:/models:ro`,
				"docker.io/library/busybox:1.37",
				"test",
				"-f",
				`/models/${normalizedPath}`,
			],
			signal,
		);
		if (fileCheck.exitCode === 0) continue;

		const modelDir = posixPath.dirname(normalizedPath);
		if (modelDir !== ".") {
			const mkdirResult = await run(
				"podman",
				[
					"run",
					"--rm",
					"-v",
					`${model.volume}:/models`,
					"docker.io/library/busybox:1.37",
					"mkdir",
					"-p",
					`/models/${modelDir}`,
				],
				signal,
			);
			if (mkdirResult.exitCode !== 0) {
				return { ok: false, downloaded, note: `Failed to create model directory ${modelDir}: ${mkdirResult.stderr}` };
			}
		}

		// Download model into volume
		const dlResult = await run(
			"podman",
			[
				"run",
				"--rm",
				"-v",
				`${model.volume}:/models`,
				"docker.io/curlimages/curl:8.12.1",
				"-L",
				"-o",
				`/models/${normalizedPath}`,
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

function normalizeModelPath(modelPath: string): string | null {
	if (!modelPath.trim()) return null;
	const normalized = posixPath.normalize(modelPath);
	if (normalized.startsWith("/") || normalized === ".." || normalized.startsWith("../")) return null;
	return normalized;
}

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
