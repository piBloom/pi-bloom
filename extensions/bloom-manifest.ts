/**
 * 📋 bloom-manifest — Declarative service manifest: show, sync, set, apply.
 *
 * @tools manifest_show, manifest_sync, manifest_set_service, manifest_apply
 * @hooks session_start
 * @see {@link ../AGENTS.md#bloom-os} Extension reference
 */
import { existsSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { run } from "../lib/exec.js";
import {
	detectRunningServices,
	installServicePackage,
	loadManifest,
	loadServiceCatalog,
	type Manifest,
	saveManifest,
	servicePreflightErrors,
} from "../lib/manifest.js";
import { errorResult, getBloomDir, getServiceRegistry, requireConfirmation, truncate } from "../lib/shared.js";

export default function (pi: ExtensionAPI) {
	const bloomDir = getBloomDir();
	const manifestPath = join(bloomDir, "manifest.yaml");
	const dotBloomDir = join(os.homedir(), ".bloom");
	const repoDir = join(dotBloomDir, "pi-bloom");
	const defaultServiceRegistry = getServiceRegistry();

	pi.registerTool({
		name: "manifest_show",
		label: "Show Manifest",
		description: "Display the declarative service manifest from ~/Bloom/manifest.yaml",
		promptSnippet: "manifest_show — display the Bloom service manifest",
		promptGuidelines: ["Use manifest_show to view the current manifest state and configured services."],
		parameters: Type.Object({}),
		async execute() {
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
		},
	});

	pi.registerTool({
		name: "manifest_sync",
		label: "Sync Manifest",
		description:
			"Reconcile the manifest with actual running containers. Detects drift and can update the manifest or report differences.",
		promptSnippet: "manifest_sync — reconcile manifest with running state",
		promptGuidelines: [
			"Use manifest_sync to detect drift between the manifest and reality.",
			"Pass mode='detect' (default) to report differences, mode='update' to update the manifest to match reality.",
		],
		parameters: Type.Object({
			mode: Type.Optional(
				StringEnum(["detect", "update"] as const, {
					description: "detect (report drift) or update (write manifest from running state)",
					default: "detect",
				}),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			const mode = params.mode ?? "detect";
			const manifest = loadManifest(manifestPath);
			const running = await detectRunningServices(signal);

			const bootcResult = await run("bootc", ["status", "--format=json"], signal);
			let osImage = manifest.os_image;
			if (bootcResult.exitCode === 0) {
				try {
					const status = JSON.parse(bootcResult.stdout) as {
						status?: { booted?: { image?: { image?: { image?: string } } } };
					};
					osImage = status?.status?.booted?.image?.image?.image ?? osImage;
				} catch {
					// keep existing
				}
			}

			const drifts: string[] = [];

			for (const [name, svc] of Object.entries(manifest.services)) {
				if (svc.enabled && !running.has(name)) {
					drifts.push(`- ${name}: manifest says enabled, but not running`);
				}
			}

			for (const [name, info] of running) {
				if (!manifest.services[name]) {
					drifts.push(`- ${name}: running (${info.image}) but not in manifest`);
				} else if (manifest.services[name].image !== info.image) {
					drifts.push(`- ${name}: image mismatch — manifest: ${manifest.services[name].image}, actual: ${info.image}`);
				}
			}

			if (osImage && manifest.os_image && osImage !== manifest.os_image) {
				drifts.push(`- OS image: manifest: ${manifest.os_image}, actual: ${osImage}`);
			}

			if (mode === "update") {
				const hostname = os.hostname();
				const updated: Manifest = {
					device: manifest.device || hostname,
					os_image: osImage,
					services: { ...manifest.services },
				};

				for (const [name, info] of running) {
					if (!updated.services[name]) {
						updated.services[name] = { image: info.image, enabled: true };
					} else {
						updated.services[name].image = info.image;
						updated.services[name].enabled = true;
					}
				}

				saveManifest(updated, manifestPath);
				const text =
					drifts.length > 0
						? `Manifest updated. Resolved ${drifts.length} drift(s):\n${drifts.join("\n")}`
						: "Manifest updated. No drift detected.";
				return { content: [{ type: "text" as const, text }], details: updated };
			}

			if (drifts.length === 0) {
				return {
					content: [{ type: "text" as const, text: "No drift detected. Manifest matches running state." }],
					details: {},
				};
			}
			return {
				content: [
					{
						type: "text" as const,
						text: `${drifts.length} drift(s) detected:\n${drifts.join("\n")}\n\nRun manifest_sync with mode='update' to reconcile.`,
					},
				],
				details: { drifts },
			};
		},
	});

	pi.registerTool({
		name: "manifest_set_service",
		label: "Set Manifest Service",
		description: "Add or update a service entry in the manifest.",
		promptSnippet: "manifest_set_service — add/update a service in the manifest",
		promptGuidelines: ["Use manifest_set_service to declare a service in the manifest."],
		parameters: Type.Object({
			name: Type.String({ description: "Service name (e.g. whatsapp, whisper)" }),
			image: Type.String({ description: "Container image reference" }),
			version: Type.Optional(Type.String({ description: "Semver version tag" })),
			enabled: Type.Optional(Type.Boolean({ description: "Whether service should be running (default: true)" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const manifest = loadManifest(manifestPath);
			manifest.services[params.name] = {
				image: params.image,
				version: params.version,
				enabled: params.enabled ?? true,
			};
			saveManifest(manifest, manifestPath);
			return {
				content: [
					{
						type: "text" as const,
						text: `Service ${params.name} set in manifest: ${params.image}${params.version ? `@${params.version}` : ""} [${params.enabled !== false ? "enabled" : "disabled"}]`,
					},
				],
				details: {},
			};
		},
	});

	pi.registerTool({
		name: "manifest_apply",
		label: "Apply Manifest",
		description:
			"Apply desired service state from manifest: install/start enabled services and stop disabled services.",
		promptSnippet: "manifest_apply — apply manifest desired service state",
		promptGuidelines: [
			"Use manifest_apply to enact desired service state from manifest.yaml.",
			"Prefer install_missing=true for first-time setup on fresh devices.",
		],
		parameters: Type.Object({
			install_missing: Type.Optional(
				Type.Boolean({
					description: "Install missing services from OCI artifacts before applying state",
					default: true,
				}),
			),
			registry: Type.Optional(
				Type.String({ description: "Registry namespace for service artifacts", default: defaultServiceRegistry }),
			),
			allow_latest: Type.Optional(
				Type.Boolean({ description: "Allow installing latest when manifest version is missing", default: false }),
			),
			dry_run: Type.Optional(Type.Boolean({ description: "Preview actions without mutating system", default: false })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const manifest = loadManifest(manifestPath);
			const serviceEntries = Object.entries(manifest.services).sort(([a], [b]) => a.localeCompare(b));
			if (serviceEntries.length === 0) {
				return errorResult("Manifest has no services. Use manifest_set_service first.");
			}

			const installMissing = params.install_missing ?? true;
			const registry = params.registry ?? defaultServiceRegistry;
			const allowLatest = params.allow_latest ?? false;
			const dryRun = params.dry_run ?? false;

			if (!dryRun) {
				const denied = await requireConfirmation(ctx, `Apply manifest to ${serviceEntries.length} service(s)`);
				if (denied) return errorResult(denied);
			}

			const catalog = loadServiceCatalog(repoDir);
			const lines: string[] = [];
			const errors: string[] = [];
			let installedCount = 0;
			let startedCount = 0;
			let stoppedCount = 0;
			let manifestChanged = false;
			let needsReload = false;

			const systemdDir = join(os.homedir(), ".config", "containers", "systemd");
			const userSystemdDir = join(os.homedir(), ".config", "systemd", "user");

			for (const [name, svc] of serviceEntries) {
				if (!svc.enabled) continue;

				const unit = `bloom-${name}`;
				const containerDef = join(systemdDir, `${unit}.container`);
				if (existsSync(containerDef)) continue;

				if (!installMissing) {
					errors.push(`${name}: missing unit ${containerDef} (set install_missing=true to auto-install)`);
					continue;
				}

				const catalogEntry = catalog[name];
				const version = svc.version?.trim() || catalogEntry?.version || "latest";
				if (version === "latest" && !allowLatest) {
					errors.push(`${name}: refused auto-install with version=latest (set explicit version or allow_latest=true)`);
					continue;
				}

				const preflight = await servicePreflightErrors(name, catalogEntry, signal);
				if (preflight.length > 0) {
					errors.push(`${name}: preflight failed — ${preflight.join("; ")}`);
					continue;
				}

				if (dryRun) {
					lines.push(`[dry-run] install ${name}@${version}`);
					installedCount += 1;
					continue;
				}

				const install = await installServicePackage(name, version, registry, bloomDir, repoDir, catalogEntry, signal);
				if (!install.ok) {
					errors.push(`${name}: install failed — ${install.note ?? "unknown error"}`);
					continue;
				}

				installedCount += 1;
				needsReload = true;
				lines.push(
					install.source === "oci"
						? `Installed ${name} from ${install.ref}`
						: `Installed ${name} from bundled local package (OCI ref: ${install.ref})`,
				);

				if (!svc.version) {
					manifest.services[name].version = version;
					manifestChanged = true;
				}
				if ((!svc.image || svc.image === "unknown") && catalogEntry?.image) {
					manifest.services[name].image = catalogEntry.image;
					manifestChanged = true;
				}
			}

			if (needsReload && !dryRun) {
				const reload = await run("systemctl", ["--user", "daemon-reload"], signal);
				if (reload.exitCode !== 0) {
					return errorResult(`manifest_apply: daemon-reload failed:\n${reload.stderr || reload.stdout}`);
				}
			}

			for (const [name, svc] of serviceEntries) {
				const unit = `bloom-${name}`;
				const containerDef = join(systemdDir, `${unit}.container`);
				const socketDef = join(userSystemdDir, `${unit}.socket`);
				const startTarget = existsSync(socketDef) ? `${unit}.socket` : `${unit}.service`;

				if (svc.enabled) {
					if (!existsSync(containerDef)) {
						errors.push(`${name}: cannot start, unit not installed`);
						continue;
					}

					if (dryRun) {
						lines.push(`[dry-run] start ${startTarget}`);
						startedCount += 1;
						continue;
					}

					const start = await run("systemctl", ["--user", "start", startTarget], signal);
					if (start.exitCode !== 0) {
						errors.push(`${name}: failed to start ${startTarget}: ${start.stderr || start.stdout}`);
					} else {
						startedCount += 1;
						lines.push(`Started ${startTarget}`);
					}
					continue;
				}

				if (dryRun) {
					lines.push(`[dry-run] stop ${unit}.socket (if present)`);
					lines.push(`[dry-run] stop ${unit}.service`);
					stoppedCount += 1;
					continue;
				}

				await run("systemctl", ["--user", "stop", `${unit}.socket`], signal);
				await run("systemctl", ["--user", "stop", `${unit}.service`], signal);
				stoppedCount += 1;
				lines.push(`Stopped ${unit}`);
			}

			if (manifestChanged && !dryRun) {
				saveManifest(manifest, manifestPath);
			}

			const summary = [
				`Manifest apply complete (${dryRun ? "dry-run" : "live"}).`,
				`Installed: ${installedCount}`,
				`Started/enabled: ${startedCount}`,
				`Stopped/disabled: ${stoppedCount}`,
				`Errors: ${errors.length}`,
				"",
				...(lines.length > 0 ? ["Actions:", ...lines, ""] : []),
				...(errors.length > 0 ? ["Errors:", ...errors] : []),
			].join("\n");

			return {
				content: [{ type: "text" as const, text: truncate(summary) }],
				details: {
					installed: installedCount,
					started: startedCount,
					stopped: stoppedCount,
					errors,
					dryRun,
				},
				isError: errors.length > 0,
			};
		},
	});

	// Drift detection on session start
	pi.on("session_start", async (_event, ctx) => {
		if (!existsSync(manifestPath)) return;
		const manifest = loadManifest(manifestPath);
		const svcCount = Object.keys(manifest.services).length;
		if (svcCount === 0) return;

		const running = await detectRunningServices();
		const drifts: string[] = [];
		for (const [name, svc] of Object.entries(manifest.services)) {
			if (svc.enabled && !running.has(name)) {
				drifts.push(`${name} (not running)`);
			}
		}

		if (ctx.hasUI) {
			if (drifts.length > 0) {
				ctx.ui.setWidget("bloom-manifest", [`Manifest drift: ${drifts.join(", ")}`]);
			}
			ctx.ui.setStatus("bloom-manifest", `Manifest: ${svcCount} services`);
		}
	});
}
