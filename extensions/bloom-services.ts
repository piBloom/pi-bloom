/**
 * bloom-services — Service lifecycle: scaffold, install, test, and declarative manifest management.
 *
 * @tools service_scaffold, service_install, service_test, service_pair, manifest_show, manifest_sync, manifest_set_service, manifest_apply
 * @hooks session_start
 * @see {@link ../AGENTS.md#bloom-services} Extension reference
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import QRCode from "qrcode";
import { run } from "../lib/exec.js";
import { getBloomDir } from "../lib/filesystem.js";
import { parseFrontmatter } from "../lib/frontmatter.js";
import {
	buildLocalImage,
	detectRunningServices,
	downloadServiceModels,
	installServicePackage,
	loadManifest,
	loadServiceCatalog,
	type Manifest,
	saveManifest,
	servicePreflightErrors,
	validatePinnedImage,
	validateServiceName,
} from "../lib/services.js";
import { createLogger, errorResult, requireConfirmation, truncate } from "../lib/shared.js";
import { clearPairingData, getPairingData } from "./bloom-channels.js";

const log = createLogger("bloom-services");

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractSkillMetadata(skillPath: string): { image?: string; version?: string } {
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

export default function (pi: ExtensionAPI) {
	const bloomDir = getBloomDir();
	const manifestPath = join(bloomDir, "manifest.yaml");
	const dotBloomDir = join(os.homedir(), ".bloom");
	const repoDir = join(dotBloomDir, "pi-bloom");

	pi.registerTool({
		name: "service_scaffold",
		label: "Scaffold Service Package",
		description: "Generate a new Bloom service package (quadlet + SKILL.md) from a template.",
		promptGuidelines: ["Use pinned image tags or digests; avoid latest/latest-* tags."],
		parameters: Type.Object({
			name: Type.String({ description: "Service name (kebab-case, e.g. my-api)" }),
			description: Type.String({ description: "Short service description" }),
			image: Type.String({ description: "Container image reference" }),
			version: Type.Optional(Type.String({ description: "Service package version", default: "0.1.0" })),
			category: Type.Optional(Type.String({ description: "Category annotation (e.g. utility, media)" })),
			port: Type.Optional(Type.Number({ description: "Exposed local port (if any)" })),
			container_port: Type.Optional(Type.Number({ description: "Port inside container", default: 8000 })),
			network: Type.Optional(Type.String({ description: "Podman network name", default: "bloom.network" })),
			memory: Type.Optional(Type.String({ description: "Memory limit (e.g. 256m)", default: "256m" })),
			socket_activated: Type.Optional(
				Type.Boolean({ description: "Generate .socket activation unit", default: false }),
			),
			overwrite: Type.Optional(Type.Boolean({ description: "Overwrite existing files if present", default: false })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const guard = validateServiceName(params.name);
			if (guard) return errorResult(guard);
			const imageGuard = validatePinnedImage(params.image);
			if (imageGuard) return errorResult(imageGuard);

			const scaffoldRepoDir = resolveRepoDir(ctx);
			const serviceDir = join(scaffoldRepoDir, "services", params.name);
			const quadletDir = join(serviceDir, "quadlet");
			const skillPath = join(serviceDir, "SKILL.md");
			const containerPath = join(quadletDir, `bloom-${params.name}.container`);
			const socketPath = join(quadletDir, `bloom-${params.name}.socket`);

			const overwrite = params.overwrite ?? false;
			if (existsSync(serviceDir) && !overwrite) {
				return errorResult(`Service directory already exists: ${serviceDir}. Use overwrite=true to replace files.`);
			}

			mkdirSync(quadletDir, { recursive: true });

			const version = params.version ?? "0.1.0";
			const network = params.network ?? "bloom.network";
			const memory = params.memory ?? "256m";
			const containerPort = Math.max(1, Math.round(params.container_port ?? 8000));
			const enableSocket = params.socket_activated ?? false;
			const maybePublish =
				!enableSocket && params.port ? `PublishPort=127.0.0.1:${Math.round(params.port)}:${containerPort}\n` : "";
			const maybeSocketArgs = enableSocket ? "PodmanArgs=--preserve-fds=1\n" : "";
			const installBlock = enableSocket ? "" : "\n[Install]\nWantedBy=default.target\n";

			const containerUnit = `[Unit]\nDescription=Bloom ${params.name} — ${params.description}\nAfter=network-online.target\nWants=network-online.target\n${enableSocket ? "StopWhenUnneeded=true\n" : ""}\n[Container]\nImage=${params.image}\nContainerName=bloom-${params.name}\nNetwork=${network}\n${maybePublish}${maybeSocketArgs}PodmanArgs=--memory=${memory}\nNoNewPrivileges=true\nLogDriver=journald\n\n[Service]\nRestart=on-failure\nRestartSec=10\nTimeoutStartSec=300\n${installBlock}`;
			writeFileSync(containerPath, containerUnit);

			if (enableSocket && params.port) {
				const socketUnit = `[Unit]\nDescription=Bloom ${params.name} — Socket activation listener\n\n[Socket]\nListenStream=127.0.0.1:${Math.round(params.port)}\nAccept=no\nService=bloom-${params.name}.service\nSocketMode=0660\n\n[Install]\nWantedBy=sockets.target\n`;
				writeFileSync(socketPath, socketUnit);
			}

			const skill = `---\nname: ${params.name}\nversion: ${version}\ndescription: ${params.description}\nimage: ${params.image}\n---\n\n# ${params.name}\n\nDescribe how to use this service.\n\n## API\n\nDocument endpoints, commands, and examples here.\n\n## Operations\n\n- Install: \`systemctl --user start bloom-${params.name}\`\n- Logs: \`journalctl --user -u bloom-${params.name} -n 100\`\n`;
			writeFileSync(skillPath, skill);

			const created = [containerPath, skillPath];
			if (existsSync(socketPath)) created.push(socketPath);

			return {
				content: [
					{ type: "text" as const, text: `Service scaffold created:\n${created.map((f) => `- ${f}`).join("\n")}` },
				],
				details: {
					repoDir: scaffoldRepoDir,
					service: params.name,
					category: params.category ?? null,
					files: created,
				},
			};
		},
	});

	pi.registerTool({
		name: "service_install",
		label: "Install Service Package",
		description: "Install a service package from a bundled local package to Quadlet + Bloom skill paths.",
		parameters: Type.Object({
			name: Type.String({ description: "Service name (e.g. llm)" }),
			version: Type.Optional(Type.String({ description: "Version tag for manifest", default: "latest" })),
			start: Type.Optional(Type.Boolean({ description: "Enable/start service after install", default: true })),
			update_manifest: Type.Optional(
				Type.Boolean({ description: "Update manifest.yaml with installed version", default: true }),
			),
		}),
		async execute(_toolCallId, params, signal) {
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

			const install = await installServicePackage(params.name, version, bloomDir, repoDir, catalogEntry, signal);
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

			// Auto-install dependencies (e.g., stt for whatsapp/signal)
			const deps = catalogEntry?.depends ?? [];
			for (const dep of deps) {
				const depUnit = join(os.homedir(), ".config", "containers", "systemd", `bloom-${dep}.container`);
				if (existsSync(depUnit)) continue; // already installed

				const depCatalog = catalog[dep];
				const depVersion = depCatalog?.version ?? "latest";
				const depPreflight = await servicePreflightErrors(dep, depCatalog, signal);
				if (depPreflight.length > 0) {
					log.warn("dependency preflight failed", { dep, errors: depPreflight });
					continue;
				}

				const depInstall = await installServicePackage(dep, depVersion, bloomDir, repoDir, depCatalog, signal);
				if (!depInstall.ok) {
					log.warn("dependency install failed", { dep, note: depInstall.note });
					continue;
				}

				const depImage = depCatalog?.image ?? "";
				const depBuild = await buildLocalImage(dep, depImage, repoDir, signal);
				if (!depBuild.ok) {
					log.warn("dependency image build failed", { dep, note: depBuild.note });
					continue;
				}

				if (depCatalog?.models && depCatalog.models.length > 0) {
					const depModels = await downloadServiceModels(depCatalog.models, signal);
					if (!depModels.ok) {
						log.warn("dependency model download failed", { dep, note: depModels.note });
					}
				}

				await run("systemctl", ["--user", "daemon-reload"], signal);
				await run("systemctl", ["--user", "start", `bloom-${dep}.service`], signal);

				const depManifest = loadManifest(manifestPath);
				depManifest.services[dep] = {
					image: depImage || "unknown",
					version: depVersion,
					enabled: true,
				};
				saveManifest(depManifest, manifestPath);
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
		},
	});

	pi.registerTool({
		name: "service_test",
		label: "Test Service",
		description: "Smoke-test installed service unit: reload, start, wait, inspect status/logs, optional cleanup.",
		parameters: Type.Object({
			name: Type.String({ description: "Installed service name (e.g. llm)" }),
			start_timeout_sec: Type.Optional(Type.Number({ description: "Timeout waiting for active state", default: 120 })),
			cleanup: Type.Optional(Type.Boolean({ description: "Stop unit(s) after test", default: false })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			const guard = validateServiceName(params.name);
			if (guard) return errorResult(guard);

			const timeoutSec = Math.max(10, Math.round(params.start_timeout_sec ?? 120));
			const cleanup = params.cleanup ?? false;
			const systemdDir = join(os.homedir(), ".config", "containers", "systemd");
			const userSystemdDir = join(os.homedir(), ".config", "systemd", "user");
			const containerDef = join(systemdDir, `bloom-${params.name}.container`);
			const socketDef = join(userSystemdDir, `bloom-${params.name}.socket`);
			if (!existsSync(containerDef)) {
				return errorResult(`Service not installed: ${containerDef} not found.`);
			}

			const socketMode = existsSync(socketDef);
			const serviceUnit = `bloom-${params.name}`;
			const startUnit = socketMode ? `${serviceUnit}.socket` : `${serviceUnit}.service`;

			const reload = await run("systemctl", ["--user", "daemon-reload"], signal);
			if (reload.exitCode !== 0) return errorResult(`daemon-reload failed:\n${reload.stderr}`);

			const startResult = await run("systemctl", ["--user", "start", startUnit], signal);
			if (startResult.exitCode !== 0) return errorResult(`Failed to start ${startUnit}:\n${startResult.stderr}`);

			let active = false;
			const waitUntil = Date.now() + timeoutSec * 1000;
			while (Date.now() < waitUntil) {
				const check = await run("systemctl", ["--user", "is-active", serviceUnit], signal);
				if (check.exitCode === 0 && check.stdout.trim() === "active") {
					active = true;
					break;
				}
				if (socketMode) {
					const socketActive = await run("systemctl", ["--user", "is-active", `${serviceUnit}.socket`], signal);
					if (socketActive.exitCode === 0 && socketActive.stdout.trim() === "active") {
						active = true;
						break;
					}
				}
				await sleep(2000);
			}

			const status = await run("systemctl", ["--user", "status", serviceUnit, "--no-pager"], signal);
			const logs = await run("journalctl", ["--user", "-u", serviceUnit, "-n", "80", "--no-pager"], signal);
			const socketStatus = socketMode
				? await run("systemctl", ["--user", "status", `${serviceUnit}.socket`, "--no-pager"], signal)
				: null;

			if (cleanup) {
				await run("systemctl", ["--user", "stop", serviceUnit], signal);
				if (socketMode) await run("systemctl", ["--user", "stop", `${serviceUnit}.socket`], signal);
			}

			const resultText = [
				`Service test: ${params.name}`,
				`Mode: ${socketMode ? "socket-activated" : "service"}`,
				`Result: ${active ? "PASS" : "FAIL"}`,
				"",
				"## systemctl status",
				"```",
				status.stdout.trim() || status.stderr.trim() || "(no output)",
				"```",
				...(socketStatus
					? [
							"",
							"## socket status",
							"```",
							socketStatus.stdout.trim() || socketStatus.stderr.trim() || "(no output)",
							"```",
						]
					: []),
				"",
				"## recent logs",
				"```",
				logs.stdout.trim() || logs.stderr.trim() || "(no log output)",
				"```",
			].join("\n");

			return {
				content: [{ type: "text" as const, text: truncate(resultText) }],
				details: { active, socketMode, cleanup },
				isError: !active,
			};
		},
	});

	pi.registerTool({
		name: "service_pair",
		label: "Pair Messaging Service",
		description:
			"Get a QR code for pairing WhatsApp or Signal. Returns ASCII QR art inline. For WhatsApp, scan with WhatsApp mobile app (Settings > Linked Devices). For Signal, scan with Signal app (Settings > Linked Devices > Link New Device).",
		parameters: Type.Object({
			name: StringEnum(["whatsapp", "signal"] as const, {
				description: "Service to pair",
			}),
			timeout_sec: Type.Optional(Type.Number({ description: "Max seconds to wait for QR data", default: 60 })),
		}),
		async execute(_toolCallId, params, signal) {
			const serviceName = params.name;
			const timeoutSec = Math.max(10, Math.round(params.timeout_sec ?? 60));
			const unit = `bloom-${serviceName}.service`;

			// Check service is installed
			const systemdDir = join(os.homedir(), ".config", "containers", "systemd");
			if (!existsSync(join(systemdDir, `bloom-${serviceName}.container`))) {
				return errorResult(`${serviceName} is not installed. Run service_install(name="${serviceName}") first.`);
			}

			// Restart service to trigger fresh QR/linking
			await run("systemctl", ["--user", "restart", unit], signal);

			// Clear old pairing data
			clearPairingData(serviceName);

			// Poll for pairing data from channel bridge
			const deadline = Date.now() + timeoutSec * 1000;
			let pairingData: string | null = null;

			while (Date.now() < deadline) {
				pairingData = getPairingData(serviceName);
				if (pairingData) break;

				// Fallback: check journalctl for pairing data
				const logs = await run(
					"journalctl",
					["--user", "-u", unit, "-n", "50", "--no-pager", "--since", "30s ago"],
					signal,
				);
				if (serviceName === "signal") {
					const match = logs.stdout.match(/(sgnl:\/\/linkdevice\?[^\s]+)/);
					if (match) {
						pairingData = match[1];
						break;
					}
				}

				await sleep(2000);
			}

			if (!pairingData) {
				return errorResult(
					`No pairing data received within ${timeoutSec}s. Check service logs: journalctl --user -u ${unit} -n 100`,
				);
			}

			// Generate ASCII QR code
			try {
				const qrArt = await QRCode.toString(pairingData, { type: "terminal", small: true });
				const instructions =
					serviceName === "whatsapp"
						? "Scan this QR code with your WhatsApp mobile app:\nSettings > Linked Devices > Link a Device"
						: "Scan this QR code with your Signal mobile app:\nSettings > Linked Devices > Link New Device";

				return {
					content: [{ type: "text" as const, text: `${instructions}\n\n${qrArt}` }],
					details: { service: serviceName, paired: false },
				};
			} catch (err) {
				return errorResult(`Failed to generate QR code: ${(err as Error).message}`);
			}
		},
	});

	// -----------------------------------------------------------------------
	// Manifest tools (merged from bloom-manifest)
	// -----------------------------------------------------------------------

	pi.registerTool({
		name: "manifest_show",
		label: "Show Manifest",
		description: "Display the declarative service manifest from ~/Bloom/manifest.yaml",
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
					details: {} as Manifest,
				};
			}
			return {
				content: [
					{
						type: "text" as const,
						text: `${drifts.length} drift(s) detected:\n${drifts.join("\n")}\n\nRun manifest_sync with mode='update' to reconcile.`,
					},
				],
				details: { drifts } as unknown as Manifest,
			};
		},
	});

	pi.registerTool({
		name: "manifest_set_service",
		label: "Set Manifest Service",
		description: "Add or update a service entry in the manifest.",
		parameters: Type.Object({
			name: Type.String({ description: "Service name (e.g. whatsapp, llm)" }),
			image: Type.String({ description: "Container image reference" }),
			version: Type.Optional(Type.String({ description: "Semver version tag" })),
			enabled: Type.Optional(Type.Boolean({ description: "Whether service should be running (default: true)" })),
		}),
		async execute(_toolCallId, params) {
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
		parameters: Type.Object({
			install_missing: Type.Optional(
				Type.Boolean({
					description: "Install missing services from bundled local packages before applying state",
					default: true,
				}),
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

				const installResult = await installServicePackage(name, version, bloomDir, repoDir, catalogEntry, signal);
				if (!installResult.ok) {
					errors.push(`${name}: install failed — ${installResult.note ?? "unknown error"}`);
					continue;
				}

				installedCount += 1;
				needsReload = true;
				lines.push(`Installed ${name} from bundled local package`);

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

					const startResult = await run("systemctl", ["--user", "start", startTarget], signal);
					if (startResult.exitCode !== 0) {
						errors.push(`${name}: failed to start ${startTarget}: ${startResult.stderr || startResult.stdout}`);
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

	// -----------------------------------------------------------------------
	// Merged session_start hook (service status + manifest drift detection)
	// -----------------------------------------------------------------------

	pi.on("session_start", async (_event, ctx) => {
		log.info("service lifecycle extension loaded");

		if (ctx.hasUI) {
			ctx.ui.setStatus("bloom-services", "Services: lifecycle tools ready");
		}

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
				ctx.ui.setWidget("bloom-services", [`Manifest drift: ${drifts.join(", ")}`]);
			}
			ctx.ui.setStatus("bloom-services", `Services: ${svcCount} in manifest`);
		}
	});
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Walk up from ctx.cwd to find the repo dir containing services/ and package.json. */
function resolveRepoDir(ctx: ExtensionContext): string {
	let current = ctx.cwd;
	for (let i = 0; i < 6; i++) {
		if (existsSync(join(current, "services")) && existsSync(join(current, "package.json"))) {
			return current;
		}
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	const preferred = join(os.homedir(), ".bloom", "pi-bloom");
	if (existsSync(join(preferred, "services"))) return preferred;
	return ctx.cwd;
}
