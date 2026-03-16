/**
 * Manifest handlers for bloom-services — show, sync, set, and apply declarative service state.
 */
import os from "node:os";
import { join } from "node:path";
import { writeServiceHomeRuntime } from "../../lib/service-home.js";
import { type Manifest, loadManifest, saveManifest } from "../../lib/services-manifest.js";
import { validateServiceName } from "../../lib/services-validation.js";
import { errorResult } from "../../lib/shared.js";
import { detectRunningServices } from "./service-io.js";

export function handleManifestShow(manifestPath: string) {
	const manifest = loadManifest(manifestPath);
	if (Object.keys(manifest.services).length === 0 && !manifest.device) {
		return {
			content: [
				{
					type: "text" as const,
					text: "No manifest found. Use manifest_sync to generate one from running services.",
				},
			],
			details: {},
		};
	}
	const lines: string[] = [];
	if (manifest.device) lines.push(`Device: ${manifest.device}`);
	if (manifest.os_image) lines.push(`OS Image: ${manifest.os_image}`);
	lines.push("");
	const svcs = Object.entries(manifest.services);
	if (svcs.length === 0) {
		lines.push("No services configured.");
	} else {
		lines.push("Services:");
		for (const [name, svc] of svcs) {
			const ver = svc.version ? `@${svc.version}` : "";
			const state = svc.enabled ? "enabled" : "disabled";
			lines.push(`  ${name}: ${svc.image}${ver} [${state}]`);
		}
	}
	return { content: [{ type: "text" as const, text: lines.join("\n") }], details: manifest };
}

export async function handleManifestSync(
	params: { mode?: "detect" | "update" },
	manifestPath: string,
	repoDir: string,
	signal: AbortSignal | undefined,
) {
	const mode = params.mode ?? "detect";
	const manifest = loadManifest(manifestPath);
	const running = await detectRunningServices(signal);
	const osImage = await detectBootedImage(manifest.os_image, signal);
	const drifts = collectManifestDrifts(manifest, running, osImage);

	if (mode === "update") {
		const updated = buildUpdatedManifest(manifest, running, osImage);
		saveManifest(updated, manifestPath);
		await writeServiceHomeRuntime(join(os.homedir(), ".config", "bloom"), repoDir, signal);
		const text =
			drifts.length > 0
				? `Manifest updated. Resolved ${drifts.length} drift(s):\n${drifts.join("\n")}`
				: "Manifest updated. No drift detected.";
		return { content: [{ type: "text" as const, text }], details: updated };
	}

	if (drifts.length === 0) {
		return {
			content: [{ type: "text" as const, text: "No drift detected. Manifest matches running state." }],
			details: { services: {} },
		};
	}
	return {
		content: [
			{
				type: "text" as const,
				text: `${drifts.length} drift(s) detected:\n${drifts.join("\n")}\n\nRun manifest_sync with mode='update' to reconcile.`,
			},
		],
		details: { services: {}, drifts },
	};
}

async function detectBootedImage(currentImage: string | undefined, _signal: AbortSignal | undefined) {
	return currentImage;
}

function collectManifestDrifts(
	manifest: Manifest,
	running: Awaited<ReturnType<typeof detectRunningServices>>,
	osImage: string | undefined,
) {
	const drifts: string[] = [];
	for (const [name, svc] of Object.entries(manifest.services)) {
		if (svc.enabled && !running.has(name)) {
			drifts.push(`- ${name}: manifest says enabled, but not running`);
		} else if (!svc.enabled && running.has(name)) {
			drifts.push(`- ${name}: manifest says disabled, but it is running`);
		}
	}
	for (const [name, info] of running) {
		if (!manifest.services[name]) {
			drifts.push(`- ${name}: running (${info.image}) but not in manifest`);
			continue;
		}
		if (manifest.services[name].image !== info.image) {
			drifts.push(`- ${name}: image mismatch — manifest: ${manifest.services[name].image}, actual: ${info.image}`);
		}
	}
	if (osImage && manifest.os_image && osImage !== manifest.os_image) {
		drifts.push(`- OS image: manifest: ${manifest.os_image}, actual: ${osImage}`);
	}
	return drifts;
}

function buildUpdatedManifest(
	manifest: Manifest,
	running: Awaited<ReturnType<typeof detectRunningServices>>,
	osImage: string | undefined,
): Manifest {
	const updated: Manifest = {
		device: manifest.device || os.hostname(),
		os_image: osImage,
		services: { ...manifest.services },
	};
	for (const [name, info] of running) {
		if (!updated.services[name]) {
			updated.services[name] = { image: info.image, enabled: true };
			continue;
		}
		updated.services[name].image = info.image;
		updated.services[name].enabled = true;
	}
	for (const [name, svc] of Object.entries(updated.services)) {
		if (!running.has(name)) {
			updated.services[name] = { ...svc, enabled: false };
		}
	}
	return updated;
}

export async function handleManifestSetService(
	params: {
		name: string;
		image: string;
		version?: string;
		enabled?: boolean;
	},
	manifestPath: string,
	repoDir: string,
) {
	const guard = validateServiceName(params.name);
	if (guard) return errorResult(guard);

	const manifest = loadManifest(manifestPath);
	manifest.services[params.name] = {
		image: params.image,
		version: params.version,
		enabled: params.enabled ?? true,
	};
	saveManifest(manifest, manifestPath);
	await writeServiceHomeRuntime(join(os.homedir(), ".config", "bloom"), repoDir);
	return {
		content: [
			{
				type: "text" as const,
				text: `Service ${params.name} set in manifest: ${params.image}${params.version ? `@${params.version}` : ""} [${params.enabled !== false ? "enabled" : "disabled"}]`,
			},
		],
		details: {},
	};
}
