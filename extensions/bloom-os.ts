import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { createLogger, errorResult, getGardenDir, truncate } from "./shared.js";

const require = createRequire(import.meta.url);
const yaml: { load: (str: string) => unknown; dump: (obj: unknown) => string } = require("js-yaml");

const log = createLogger("bloom-os");

const execAsync = promisify(execFile);

async function run(
	cmd: string,
	args: string[],
	signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	try {
		const { stdout, stderr } = await execAsync(cmd, args, { signal });
		return { stdout, stderr, exitCode: 0 };
	} catch (err: unknown) {
		const e = err as { message: string; stderr?: string; code?: number };
		return {
			stdout: "",
			stderr: e.stderr ?? e.message,
			exitCode: e.code ?? 1,
		};
	}
}

function guardBloom(name: string): string | null {
	if (!name.startsWith("bloom-")) {
		return `Security error: only bloom-* names are permitted, got "${name}"`;
	}
	return null;
}

async function requireConfirmation(
	ctx: ExtensionContext,
	action: string,
	options?: { requireUi?: boolean },
): Promise<string | null> {
	const requireUi = options?.requireUi ?? true;
	if (!ctx.hasUI) {
		return requireUi ? `Cannot perform "${action}" without interactive user confirmation.` : null;
	}
	const confirmed = await ctx.ui.confirm("Confirm action", `Allow: ${action}?`);
	if (!confirmed) return `User declined: ${action}`;
	return null;
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "bootc_status",
		label: "OS Image Status",
		description: "Shows the current Fedora bootc OS image status, pending updates, and rollback availability.",
		promptSnippet: "bootc_status — show OS image version and update status",
		promptGuidelines: ["Use bootc_status when the user asks about OS version, update status, or system health"],
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, signal, _onUpdate, _ctx) {
			const result = await run("bootc", ["status"], signal);
			const text = truncate(result.exitCode === 0 ? result.stdout : `Error running bootc status:\n${result.stderr}`);
			return {
				content: [{ type: "text", text }],
				details: { exitCode: result.exitCode },
				isError: result.exitCode !== 0,
			};
		},
	});

	pi.registerTool({
		name: "bootc_update",
		label: "OS Update",
		description: "Check for, download, or apply a Fedora bootc OS update using a staged workflow.",
		promptSnippet: "bootc_update — check, download, or apply OS updates",
		promptGuidelines: [
			"Use bootc_update with stage='check' first, then 'download' to fetch, then 'apply' to stage for reboot.",
			"The 'download' and 'apply' stages require user confirmation.",
		],
		parameters: Type.Object({
			stage: Type.Optional(
				StringEnum(["check", "download", "apply"] as const, {
					description: "Update stage: check (default), download (fetch only), apply (stage for reboot)",
					default: "check",
				}),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const stage = params.stage ?? "check";
			if (stage !== "check") {
				const denied = await requireConfirmation(ctx, `OS update: ${stage}`);
				if (denied) return errorResult(denied);
			}
			let cmd: string;
			let fullArgs: string[];
			switch (stage) {
				case "check":
					cmd = "bootc";
					fullArgs = ["upgrade", "--check"];
					break;
				case "download":
					cmd = "sudo";
					fullArgs = ["bootc", "upgrade", "--check"];
					break;
				case "apply":
					cmd = "sudo";
					fullArgs = ["bootc", "upgrade"];
					break;
			}
			const result = await run(cmd, fullArgs, signal);
			const text = truncate(result.exitCode === 0 ? result.stdout || "No output." : `Error:\n${result.stderr}`);
			return {
				content: [{ type: "text", text }],
				details: { exitCode: result.exitCode, stage },
				isError: result.exitCode !== 0,
			};
		},
	});

	pi.registerTool({
		name: "bootc_rollback",
		label: "OS Rollback",
		description: "Rollback to the previous Fedora bootc OS image. Requires reboot to take effect.",
		promptSnippet: "bootc_rollback — rollback to previous OS image",
		promptGuidelines: [
			"Use bootc_rollback to revert to the previous OS image after a failed update.",
			"Requires user confirmation. Takes effect on next reboot.",
		],
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, signal, _onUpdate, ctx) {
			const denied = await requireConfirmation(ctx, "Rollback to previous OS image via bootc rollback");
			if (denied) return errorResult(denied);
			const result = await run("sudo", ["bootc", "rollback"], signal);
			const text = truncate(
				result.exitCode === 0 ? result.stdout || "Rollback staged. Reboot to apply." : `Error:\n${result.stderr}`,
			);
			return {
				content: [{ type: "text", text }],
				details: { exitCode: result.exitCode },
				isError: result.exitCode !== 0,
			};
		},
	});

	pi.registerTool({
		name: "container_status",
		label: "Container Status",
		description: "Lists running Bloom containers and their health status.",
		promptSnippet: "container_status — list running bloom-* containers",
		promptGuidelines: ["Use container_status to check running Bloom containers and their health"],
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, signal, _onUpdate, _ctx) {
			const result = await run("podman", ["ps", "--format", "json", "--filter", "name=bloom-"], signal);
			if (result.exitCode !== 0) {
				return errorResult(`Error listing containers:\n${result.stderr}`);
			}
			let text: string;
			try {
				const containers = JSON.parse(result.stdout || "[]") as Array<{
					Names?: string[];
					Status?: string;
					State?: string;
					Image?: string;
				}>;
				if (containers.length === 0) {
					text = "No bloom-* containers are currently running.";
				} else {
					text = containers
						.map((c) => {
							const name = (c.Names ?? []).join(", ") || "unknown";
							const status = c.Status ?? c.State ?? "unknown";
							const image = c.Image ?? "unknown";
							return `${name}\n  status: ${status}\n  image:  ${image}`;
						})
						.join("\n\n");
				}
			} catch {
				text = result.stdout;
			}
			return { content: [{ type: "text", text: truncate(text) }], details: {} };
		},
	});

	pi.registerTool({
		name: "container_logs",
		label: "Container Logs",
		description: "Fetches recent journald logs for a Bloom service.",
		promptSnippet: "container_logs — tail logs for a bloom-* service",
		promptGuidelines: [
			"Use container_logs to check recent logs for a Bloom service. Only bloom-* services are accessible.",
		],
		parameters: Type.Object({
			service: Type.String({ description: "Service name (e.g. bloom-whatsapp)" }),
			lines: Type.Optional(Type.Number({ description: "Number of log lines to return", default: 50 })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			const guard = guardBloom(params.service);
			if (guard) return errorResult(guard);
			const n = String(params.lines ?? 50);
			const unit = `${params.service}.service`;
			const result = await run("journalctl", ["--user", "-u", unit, "--no-pager", "-n", n], signal);
			const text = truncate(
				result.exitCode === 0 ? result.stdout || "(no log output)" : `Error fetching logs:\n${result.stderr}`,
			);
			return {
				content: [{ type: "text", text }],
				details: { exitCode: result.exitCode },
				isError: result.exitCode !== 0,
			};
		},
	});

	pi.registerTool({
		name: "systemd_control",
		label: "Systemd Service Control",
		description: "Manage a Bloom user-systemd service (start, stop, restart, status).",
		promptSnippet: "systemd_control — start/stop/restart/status a bloom-* service",
		promptGuidelines: [
			"Use systemd_control to manage Bloom user-systemd services. Only bloom-* services can be controlled.",
			"Use status for read-only checks; other actions require justification.",
		],
		parameters: Type.Object({
			service: Type.String({ description: "Service name (e.g. bloom-whatsapp)" }),
			action: StringEnum(["start", "stop", "restart", "status"] as const),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const guard = guardBloom(params.service);
			if (guard) return errorResult(guard);
			const unit = `${params.service}.service`;
			const readOnly = params.action === "status";
			if (!readOnly) {
				const denied = await requireConfirmation(ctx, `systemctl ${params.action} ${unit}`);
				if (denied) return errorResult(denied);
			}
			const result = await run("systemctl", ["--user", params.action, unit], signal);
			const text = truncate(result.stdout || result.stderr || `systemctl --user ${params.action} ${unit} completed.`);
			return {
				content: [{ type: "text", text }],
				details: { exitCode: result.exitCode },
				isError: result.exitCode !== 0,
			};
		},
	});

	pi.registerTool({
		name: "container_deploy",
		label: "Deploy Container",
		description: "Reload user systemd and start a Bloom Quadlet unit.",
		promptSnippet: "container_deploy — deploy a bloom-* Quadlet container unit",
		promptGuidelines: [
			"Use container_deploy to start a new container from an existing Quadlet unit file. Only bloom-* units can be deployed.",
		],
		parameters: Type.Object({
			quadlet_name: Type.String({ description: "Name of the Quadlet unit to deploy (e.g. bloom-web)" }),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const guard = guardBloom(params.quadlet_name);
			if (guard) return errorResult(guard);
			const unit = `${params.quadlet_name}.service`;
			const denied = await requireConfirmation(ctx, `Deploy container ${unit}`);
			if (denied) return errorResult(denied);
			const reload = await run("systemctl", ["--user", "daemon-reload"], signal);
			if (reload.exitCode !== 0) {
				return errorResult(`systemctl --user daemon-reload failed:\n${reload.stderr}`);
			}
			const start = await run("systemctl", ["--user", "start", unit], signal);
			const text = truncate(
				start.exitCode === 0 ? `Started ${unit} successfully.` : `Failed to start ${unit}:\n${start.stderr}`,
			);
			return {
				content: [{ type: "text", text }],
				details: { exitCode: start.exitCode },
				isError: start.exitCode !== 0,
			};
		},
	});

	// --- Update detection tools ---

	const bloomDir = join(os.homedir(), ".bloom");
	const statusFile = join(bloomDir, "update-status.json");
	const repoDir = join(bloomDir, "pibloom");

	pi.registerTool({
		name: "update_status",
		label: "Update Status",
		description: "Reads the Bloom OS update status from the last scheduled check.",
		promptSnippet: "update_status — check if an OS update is available",
		promptGuidelines: ["Use update_status to check whether a new OS image is available before suggesting an upgrade."],
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
			try {
				const raw = await readFile(statusFile, "utf-8");
				const status = JSON.parse(raw);
				const text = status.available
					? `Update available (checked ${status.checked}). Version: ${status.version || "unknown"}`
					: `System is up to date (checked ${status.checked}).`;
				return { content: [{ type: "text", text }], details: status };
			} catch {
				return errorResult("No update status available. The update check timer may not have run yet.");
			}
		},
	});

	pi.registerTool({
		name: "schedule_reboot",
		label: "Schedule Reboot",
		description: "Schedule a system reboot after a delay (in minutes). Requires user confirmation.",
		promptSnippet: "schedule_reboot — schedule a delayed system reboot",
		promptGuidelines: [
			"ALWAYS ask for explicit user confirmation before calling schedule_reboot.",
			"Use after staging an OS update to apply it.",
		],
		parameters: Type.Object({
			delay_minutes: Type.Number({ description: "Minutes to wait before rebooting", default: 1 }),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const delay = Math.max(1, Math.round(params.delay_minutes));
			const denied = await requireConfirmation(ctx, `Schedule reboot in ${delay} minute(s)`);
			if (denied) return errorResult(denied);
			const result = await run("sudo", ["systemd-run", `--on-active=${delay}m`, "systemctl", "reboot"], signal);
			if (result.exitCode !== 0) {
				return errorResult(`Failed to schedule reboot:\n${result.stderr}`);
			}
			return {
				content: [{ type: "text", text: `Reboot scheduled in ${delay} minute(s).` }],
				details: { delay_minutes: delay },
			};
		},
	});

	pi.registerTool({
		name: "bloom_repo_status",
		label: "Bloom Repo Status",
		description: "Check if the local Bloom source repo clone exists and show its git status.",
		promptSnippet: "bloom_repo_status — check local pibloom repo clone status",
		promptGuidelines: [
			"Use bloom_repo_status to check if the local repo clone exists before attempting self-evolution git operations.",
		],
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, signal, _onUpdate, _ctx) {
			const check = await run("git", ["-C", repoDir, "rev-parse", "--git-dir"], signal);
			if (check.exitCode !== 0) {
				return errorResult(`No repo clone found at ${repoDir}. Run first-boot setup to clone it.`);
			}
			const branch = await run("git", ["-C", repoDir, "branch", "--show-current"], signal);
			const status = await run("git", ["-C", repoDir, "status", "--short"], signal);
			const log = await run("git", ["-C", repoDir, "log", "--oneline", "-5"], signal);
			const text = [
				`Branch: ${branch.stdout.trim()}`,
				`\nStatus:\n${status.stdout.trim() || "(clean)"}`,
				`\nRecent commits:\n${log.stdout.trim()}`,
			].join("\n");
			return { content: [{ type: "text", text }], details: { path: repoDir } };
		},
	});

	pi.registerTool({
		name: "system_health",
		label: "System Health",
		description: "Composite health check: OS image status, containers, disk usage, system load, and memory.",
		promptSnippet: "system_health — comprehensive system health overview",
		promptGuidelines: [
			"Use system_health for a quick overview of the entire system.",
			"Run proactively at session start or when the user asks about system health.",
		],
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, signal, _onUpdate, _ctx) {
			const sections: string[] = [];

			// OS image status
			const bootc = await run("bootc", ["status", "--format=json"], signal);
			if (bootc.exitCode === 0) {
				try {
					const status = JSON.parse(bootc.stdout) as {
						status?: { booted?: { image?: { image?: { image?: string; version?: string } } } };
					};
					const img = status?.status?.booted?.image?.image;
					sections.push(`## OS Image\n- Image: ${img?.image ?? "unknown"}\n- Version: ${img?.version ?? "unknown"}`);
				} catch {
					sections.push(`## OS Image\n${bootc.stdout.slice(0, 200)}`);
				}
			} else {
				sections.push("## OS Image\n(bootc status unavailable)");
			}

			// Container health
			const ps = await run("podman", ["ps", "--format", "json", "--filter", "name=bloom-"], signal);
			if (ps.exitCode === 0) {
				try {
					const containers = JSON.parse(ps.stdout || "[]") as Array<{
						Names?: string[];
						Status?: string;
						State?: string;
					}>;
					if (containers.length === 0) {
						sections.push("## Containers\nNo bloom-* containers running.");
					} else {
						const lines = containers.map((c) => {
							const name = (c.Names ?? []).join(", ") || "unknown";
							return `- ${name}: ${c.Status ?? c.State ?? "unknown"}`;
						});
						sections.push(`## Containers\n${lines.join("\n")}`);
					}
				} catch {
					sections.push("## Containers\n(parse error)");
				}
			}

			// Disk usage
			const df = await run("df", ["-h", "/", "/var", "/home"], signal);
			if (df.exitCode === 0) {
				sections.push(`## Disk Usage\n\`\`\`\n${df.stdout.trim()}\n\`\`\``);
			}

			// System load & memory
			const loadavg = await run("cat", ["/proc/loadavg"], signal);
			const meminfo = await run("free", ["-h", "--si"], signal);
			const uptime = await run("uptime", ["-p"], signal);

			const loadParts: string[] = [];
			if (loadavg.exitCode === 0) {
				const parts = loadavg.stdout.trim().split(/\s+/);
				loadParts.push(`Load: ${parts.slice(0, 3).join(" ")}`);
			}
			if (uptime.exitCode === 0) {
				loadParts.push(`Uptime: ${uptime.stdout.trim()}`);
			}
			if (meminfo.exitCode === 0) {
				const memLine = meminfo.stdout.split("\n").find((l) => l.startsWith("Mem:"));
				if (memLine) {
					const cols = memLine.split(/\s+/);
					loadParts.push(`Memory: ${cols[2] ?? "?"} used / ${cols[1] ?? "?"} total`);
				}
			}
			if (loadParts.length > 0) {
				sections.push(`## System\n${loadParts.map((l) => `- ${l}`).join("\n")}`);
			}

			const text = sections.join("\n\n");
			return { content: [{ type: "text", text: truncate(text) }], details: {} };
		},
	});

	// --- Declarative service manifest ---

	const gardenDir = getGardenDir();
	const manifestPath = join(gardenDir, "Bloom", "manifest.yaml");

	interface ManifestService {
		image: string;
		version?: string;
		enabled: boolean;
	}

	interface Manifest {
		device?: string;
		os_image?: string;
		services: Record<string, ManifestService>;
	}

	function loadManifest(): Manifest {
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

	function saveManifest(manifest: Manifest): void {
		mkdirSync(join(gardenDir, "Bloom"), { recursive: true });
		writeFileSync(manifestPath, yaml.dump(manifest));
	}

	async function detectRunningServices(signal?: AbortSignal): Promise<Map<string, { image: string; state: string }>> {
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

	pi.registerTool({
		name: "manifest_show",
		label: "Show Manifest",
		description: "Display the declarative service manifest from ~/Garden/Bloom/manifest.yaml",
		promptSnippet: "manifest_show — display the Bloom service manifest",
		promptGuidelines: ["Use manifest_show to view the current manifest state and configured services."],
		parameters: Type.Object({}),
		async execute() {
			const manifest = loadManifest();
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
			const manifest = loadManifest();
			const running = await detectRunningServices(signal);

			// Get OS image info
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

			// Check for services in manifest but not running
			for (const [name, svc] of Object.entries(manifest.services)) {
				if (svc.enabled && !running.has(name)) {
					drifts.push(`- ${name}: manifest says enabled, but not running`);
				}
			}

			// Check for running services not in manifest
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

				saveManifest(updated);
				const text =
					drifts.length > 0
						? `Manifest updated. Resolved ${drifts.length} drift(s):\n${drifts.join("\n")}`
						: "Manifest updated. No drift detected.";
				return { content: [{ type: "text" as const, text }], details: updated };
			}

			// detect mode
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
			const manifest = loadManifest();
			manifest.services[params.name] = {
				image: params.image,
				version: params.version,
				enabled: params.enabled ?? true,
			};
			saveManifest(manifest);
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

	// Drift detection on session start
	pi.on("session_start", async (_event, ctx) => {
		if (!existsSync(manifestPath)) return;
		const manifest = loadManifest();
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

	// --- Session-start hook: notify about pending updates ---

	let updateChecked = false;

	pi.on("before_agent_start", async (event) => {
		if (updateChecked) return;
		updateChecked = true;
		try {
			const raw = await readFile(statusFile, "utf-8");
			const status = JSON.parse(raw);
			if (status.available && !status.notified) {
				status.notified = true;
				await writeFile(statusFile, JSON.stringify(status), "utf-8");
				const note =
					"\n\n[SYSTEM] A Bloom OS update is available. " +
					"Inform the user and ask if they'd like to review and apply it.";
				return { systemPrompt: event.systemPrompt + note };
			}
		} catch {
			// No status file yet — timer hasn't run
		}
	});
}
