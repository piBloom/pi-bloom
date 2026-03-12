/**
 * Install handler for bloom-services — installs service packages from bundled local sources.
 */
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { run } from "../../lib/exec.js";
import { getQuadletDir } from "../../lib/filesystem.js";
import { parseFrontmatter } from "../../lib/frontmatter.js";
import { ensureServiceRouting } from "../../lib/service-routing.js";
import { loadServiceCatalog, servicePreflightErrors } from "../../lib/services-catalog.js";
import { loadManifest, saveManifest } from "../../lib/services-manifest.js";
import { validateServiceName } from "../../lib/services-validation.js";
import { createLogger, errorResult } from "../../lib/shared.js";
import { buildLocalImage, downloadServiceModels, installServicePackage } from "./service-io.js";

const log = createLogger("bloom-services");

export function extractSkillMetadata(skillPath: string): { image?: string; version?: string } {
	try {
		const raw = readFileSync(skillPath, "utf-8");
		const parsed = parseFrontmatter<{ image?: string; version?: string }>(raw);
		return {
			image: parsed.attributes?.image,
			version: parsed.attributes?.version,
		};
	} catch {
		return {};
	}
}

async function installDependency(
	dep: string,
	catalog: Record<string, import("../../lib/services-catalog.js").ServiceCatalogEntry>,
	bloomDir: string,
	repoDir: string,
	manifestPath: string,
	signal: AbortSignal | undefined,
) {
	const depCatalog = catalog[dep];
	const depVersion = depCatalog?.version ?? "latest";

	const depPreflight = await servicePreflightErrors(dep, depCatalog, signal);
	if (depPreflight.length > 0) {
		log.warn("dependency preflight failed", { dep, errors: depPreflight });
		return;
	}

	const depInstall = await installServicePackage(dep, bloomDir, repoDir, signal);
	if (!depInstall.ok) {
		log.warn("dependency install failed", { dep, note: depInstall.note });
		return;
	}

	const depImage = depCatalog?.image ?? "";
	const depBuild = await buildLocalImage(dep, depImage, repoDir, signal);
	if (!depBuild.ok) {
		log.warn("dependency image build failed", { dep, note: depBuild.note });
		return;
	}

	if (depCatalog?.models && depCatalog.models.length > 0) {
		const depModels = await downloadServiceModels(depCatalog.models, signal);
		if (!depModels.ok) {
			log.warn("dependency model download failed", { dep, note: depModels.note });
		}
	}

	await run("systemctl", ["--user", "daemon-reload"], signal);
	await run("systemctl", ["--user", "start", `bloom-${dep}.service`], signal);

	if (depCatalog?.port) {
		const depRouting = await ensureServiceRouting(dep, signal);
		if (!depRouting.ok && !depRouting.skipped) log.warn("dep DNS record failed", { dep, error: depRouting.error });
	}

	const depManifest = loadManifest(manifestPath);
	depManifest.services[dep] = { image: depImage || "unknown", version: depVersion, enabled: true };
	saveManifest(depManifest, manifestPath);
}

export async function handleInstall(
	params: {
		name: string;
		version?: string;
		start?: boolean;
		update_manifest?: boolean;
	},
	bloomDir: string,
	manifestPath: string,
	repoDir: string,
	signal: AbortSignal | undefined,
) {
	const guard = validateServiceName(params.name);
	if (guard) return errorResult(guard);

	const version = params.version ?? "latest";
	const start = params.start ?? true;
	const updateManifest = params.update_manifest ?? true;

	const catalog = loadServiceCatalog(repoDir);
	const catalogEntry = catalog[params.name];

	const preflight = await servicePreflightErrors(params.name, catalogEntry, signal);
	if (preflight.length > 0) {
		return errorResult(`Preflight failed: ${preflight.join("; ")}`);
	}

	const install = await installServicePackage(params.name, bloomDir, repoDir, signal);
	if (!install.ok) {
		return errorResult(install.note ?? `Install failed for ${params.name}`);
	}

	// Build local image if needed (localhost/* images)
	const catalogImage = catalogEntry?.image ?? "";
	const buildResult = await buildLocalImage(params.name, catalogImage, repoDir, signal);
	if (!buildResult.ok) {
		return errorResult(buildResult.note ?? `Image build failed for ${params.name}`);
	}

	// Download required models
	if (catalogEntry?.models && catalogEntry.models.length > 0) {
		const modelResult = await downloadServiceModels(catalogEntry.models, signal);
		if (!modelResult.ok) {
			return errorResult(modelResult.note ?? `Model download failed for ${params.name}`);
		}
	}

	const daemonReload = await run("systemctl", ["--user", "daemon-reload"], signal);
	if (daemonReload.exitCode !== 0) return errorResult(`daemon-reload failed:\n${daemonReload.stderr}`);

	const userSystemdDir = join(os.homedir(), ".config", "systemd", "user");
	const socketUnit = join(userSystemdDir, `bloom-${params.name}.socket`);
	if (start) {
		const target = existsSync(socketUnit) ? `bloom-${params.name}.socket` : `bloom-${params.name}.service`;
		const startRes = await run("systemctl", ["--user", "start", target], signal);
		if (startRes.exitCode !== 0) {
			return errorResult(`Failed to start ${target}:\n${startRes.stderr}`);
		}
	}

	// Set up DNS routing if port is defined
	if (catalogEntry?.port) {
		const routing = await ensureServiceRouting(params.name, signal);
		if (!routing.ok && !routing.skipped) log.warn("DNS record failed", { service: params.name, error: routing.error });
	}

	const skillDir = join(bloomDir, "Skills", params.name);
	const meta = extractSkillMetadata(join(skillDir, "SKILL.md"));
	if (updateManifest) {
		const manifest = loadManifest(manifestPath);
		manifest.services[params.name] = {
			image: meta.image ?? "unknown",
			version: version === "latest" ? meta.version : version,
			enabled: true,
		};
		saveManifest(manifest, manifestPath);
	}

	// Auto-install dependencies (e.g., backend for frontend)
	const deps = catalogEntry?.depends ?? [];
	for (const dep of deps) {
		const depUnit = join(getQuadletDir(), `bloom-${dep}.container`);
		if (existsSync(depUnit)) continue; // already installed
		await installDependency(dep, catalog, bloomDir, repoDir, manifestPath, signal);
	}

	return {
		content: [
			{
				type: "text" as const,
				text: `Installed ${params.name} successfully from bundled local package.`,
			},
		],
		details: {
			ref: params.name,
			installSource: "local",
			start,
			manifestUpdated: updateManifest,
			depsInstalled: deps,
		},
	};
}
