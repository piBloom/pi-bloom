/**
 * 📦 bloom-services — Service lifecycle: scaffold, publish, install, and test OCI service packages.
 *
 * @tools service_scaffold, service_publish, service_install, service_test
 * @hooks session_start
 * @see {@link ../AGENTS.md#bloom-services} Extension reference
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os, { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { run } from "../lib/exec.js";
import { loadManifest, saveManifest, servicePreflightErrors } from "../lib/manifest.js";
import {
	commandMissingError,
	resolveArtifactDigest,
	validatePinnedImage,
	validateServiceName,
} from "../lib/service-utils.js";
import {
	createLogger,
	errorResult,
	getBloomDir,
	getServiceRegistry,
	parseFrontmatter,
	truncate,
} from "../lib/shared.js";

const log = createLogger("bloom-services");

function resolvePackageRoot(): string {
	const here = dirname(fileURLToPath(import.meta.url));
	const candidates = [join(here, ".."), join(here, "../..")];
	for (const candidate of candidates) {
		if (existsSync(join(candidate, "os", "sysconfig", "bloom.network"))) {
			return candidate;
		}
	}
	return join(here, "../..");
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureCommand(name: string, args: string[], signal?: AbortSignal): Promise<string | null> {
	const check = await run(name, args, signal);
	if (check.exitCode === 0) return null;
	const output = `${check.stderr || ""}\n${check.stdout || ""}`;
	if (commandMissingError(output)) {
		return `Required command not found: ${name}`;
	}
	return null;
}

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
	const packageRoot = resolvePackageRoot();
	const defaultNetworkPath = join(packageRoot, "os", "sysconfig", "bloom.network");
	const defaultSourceRepo = process.env.BLOOM_SOURCE_REPO?.trim() || "https://github.com/pibloom/pi-bloom";

	pi.registerTool({
		name: "service_scaffold",
		label: "Scaffold Service Package",
		description: "Generate a new Bloom service package (quadlet + SKILL.md) from a template.",
		promptSnippet: "service_scaffold — create a new service package skeleton",
		promptGuidelines: [
			"Use service_scaffold to bootstrap a new OCI service package with correct Bloom conventions.",
			"Prefer upstream images and Quadlet composition (no Containerfile builds).",
			"Use pinned image tags or digests; avoid latest/latest-* tags.",
		],
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

			const repoDir = resolveRepoDir(ctx);
			const serviceDir = join(repoDir, "services", params.name);
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

			const skill = `---\nname: ${params.name}\nversion: ${version}\ndescription: ${params.description}\nimage: ${params.image}\n---\n\n# ${params.name}\n\nDescribe how to use this service.\n\n## API\n\nDocument endpoints, commands, and examples here.\n\n## Operations\n\n- Install: \`just svc-install ${params.name}\`\n- Logs: \`journalctl --user -u bloom-${params.name} -n 100\`\n`;
			writeFileSync(skillPath, skill);

			const created = [containerPath, skillPath];
			if (existsSync(socketPath)) created.push(socketPath);

			return {
				content: [
					{ type: "text" as const, text: `Service scaffold created:\n${created.map((f) => `- ${f}`).join("\n")}` },
				],
				details: {
					repoDir,
					service: params.name,
					category: params.category ?? null,
					files: created,
				},
			};
		},
	});

	pi.registerTool({
		name: "service_publish",
		label: "Publish Service Package",
		description: "Publish a service package to OCI registry via oras push.",
		promptSnippet: "service_publish — push Bloom service package to registry",
		promptGuidelines: [
			"Run service_publish after verifying package contents and local tests.",
			"Use semver tag in version for immutable releases.",
		],
		parameters: Type.Object({
			name: Type.String({ description: "Service name (e.g. whisper)" }),
			version: Type.Optional(Type.String({ description: "Tag to publish", default: "latest" })),
			registry: Type.Optional(Type.String({ description: "Registry namespace", default: getServiceRegistry() })),
			also_latest: Type.Optional(Type.Boolean({ description: "Also publish latest tag", default: true })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const guard = validateServiceName(params.name);
			if (guard) return errorResult(guard);

			const repoDir = resolveRepoDir(ctx);
			const serviceDir = join(repoDir, "services", params.name);
			const quadletDir = join(serviceDir, "quadlet");
			if (!existsSync(quadletDir)) return errorResult(`Missing quadlet directory: ${quadletDir}`);
			if (!existsSync(join(serviceDir, "SKILL.md"))) return errorResult(`Missing SKILL.md in ${serviceDir}`);

			const registry = params.registry ?? getServiceRegistry();
			const version = params.version ?? "latest";
			const tags = new Set<string>([version]);
			if ((params.also_latest ?? true) && version !== "latest") tags.add("latest");

			const quadletFiles = readdirSync(quadletDir)
				.filter((f) => statSync(join(quadletDir, f)).isFile())
				.map((f) => `quadlet/${f}:application/vnd.bloom.quadlet`);
			if (quadletFiles.length === 0) return errorResult("No quadlet files found to publish.");

			const pushed: string[] = [];
			for (const tag of tags) {
				const ref = `${registry}/bloom-svc-${params.name}:${tag}`;
				const args = [
					"push",
					ref,
					"--annotation",
					`org.opencontainers.image.title=bloom-${params.name}`,
					"--annotation",
					`org.opencontainers.image.source=${defaultSourceRepo}`,
					"--annotation",
					`org.opencontainers.image.version=${tag}`,
					...quadletFiles,
					"SKILL.md:text/markdown",
				];
				const res = await run("oras", args, signal, serviceDir);
				if (res.exitCode !== 0) {
					return errorResult(`Failed to publish ${ref}:\n${res.stderr}`);
				}
				pushed.push(ref);
			}

			return {
				content: [
					{ type: "text" as const, text: `Published service package:\n${pushed.map((r) => `- ${r}`).join("\n")}` },
				],
				details: { pushed },
			};
		},
	});

	pi.registerTool({
		name: "service_install",
		label: "Install Service Package",
		description: "Install a service package from OCI artifact to local Quadlet + Garden skill paths.",
		promptSnippet: "service_install — pull and install Bloom service package",
		promptGuidelines: [
			"Use service_install to deploy a packaged service from the registry.",
			"Prefer immutable semver tags over latest for reproducible installs.",
			"After install, verify with systemctl status and container logs.",
		],
		parameters: Type.Object({
			name: Type.String({ description: "Service name (e.g. whisper)" }),
			version: Type.Optional(Type.String({ description: "Version tag to install", default: "latest" })),
			registry: Type.Optional(Type.String({ description: "Registry namespace", default: getServiceRegistry() })),
			start: Type.Optional(Type.Boolean({ description: "Enable/start service after install", default: true })),
			update_manifest: Type.Optional(
				Type.Boolean({ description: "Update manifest.yaml with installed version", default: true }),
			),
			allow_latest: Type.Optional(
				Type.Boolean({ description: "Allow installing latest tag (non-immutable)", default: false }),
			),
			require_pinned_image: Type.Optional(
				Type.Boolean({ description: "Require SKILL.md image to be pinned (tag/digest, not latest)", default: true }),
			),
			expected_digest: Type.Optional(
				Type.String({ description: "Optional expected OCI artifact digest (sha256:...) for verification" }),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			const guard = validateServiceName(params.name);
			if (guard) return errorResult(guard);

			const registry = params.registry ?? getServiceRegistry();
			const version = params.version ?? "latest";
			const start = params.start ?? true;
			const updateManifest = params.update_manifest ?? true;
			const allowLatest = params.allow_latest ?? false;
			const requirePinnedImage = params.require_pinned_image ?? true;
			const expectedDigest = params.expected_digest?.trim().toLowerCase();
			const ref = `${registry}/bloom-svc-${params.name}:${version}`;

			if (version === "latest" && !allowLatest) {
				return errorResult(
					"Refusing non-immutable install: version=latest. Use a semver tag (e.g. 0.1.0) or set allow_latest=true explicitly.",
				);
			}

			const commandChecks: Array<[string, string[]]> = [
				["oras", ["version"]],
				["podman", ["--version"]],
				["systemctl", ["--version"]],
			];
			for (const [command, args] of commandChecks) {
				const missing = await ensureCommand(command, args, signal);
				if (missing) return errorResult(missing);
			}

			const tempDir = join(tmpdir(), `bloom-svc-${params.name}-${Date.now()}`);
			mkdirSync(tempDir, { recursive: true });

			try {
				const resolvedDigest = await resolveArtifactDigest(ref, signal);
				if (expectedDigest) {
					if (!expectedDigest.match(/^sha256:[a-f0-9]{64}$/)) {
						return errorResult("expected_digest must be in sha256:<64-hex> format.");
					}
					if (!resolvedDigest) {
						return errorResult(`Could not resolve digest for ${ref}. Cannot verify expected digest ${expectedDigest}.`);
					}
					if (resolvedDigest !== expectedDigest) {
						return errorResult(
							`Digest verification failed for ${ref}. Expected ${expectedDigest}, got ${resolvedDigest}.`,
						);
					}
				}

				let installSource: "oci" | "local" = "oci";
				let sourceNote: string | null = null;
				const pull = await run("oras", ["pull", ref, "-o", tempDir], signal);
				if (pull.exitCode !== 0) {
					const localServiceDir = join(packageRoot, "services", params.name);
					const localQuadlet = join(localServiceDir, "quadlet");
					const localSkill = join(localServiceDir, "SKILL.md");
					if (!existsSync(localQuadlet) || !existsSync(localSkill)) {
						return errorResult(`Failed to pull ${ref}:\n${pull.stderr || pull.stdout}`);
					}

					const localTempQuadlet = join(tempDir, "quadlet");
					mkdirSync(localTempQuadlet, { recursive: true });
					for (const name of readdirSync(localQuadlet)) {
						const src = join(localQuadlet, name);
						if (!statSync(src).isFile()) continue;
						writeFileSync(join(localTempQuadlet, name), readFileSync(src));
					}
					writeFileSync(join(tempDir, "SKILL.md"), readFileSync(localSkill));
					installSource = "local";
					sourceNote = `OCI pull failed for ${ref}; installed bundled local service package from ${localServiceDir}.`;
				}

				const quadletSrc = join(tempDir, "quadlet");
				const skillSrc = join(tempDir, "SKILL.md");
				if (!existsSync(quadletSrc)) return errorResult(`Artifact ${ref} missing quadlet/ directory.`);
				if (!existsSync(skillSrc)) return errorResult(`Artifact ${ref} missing SKILL.md.`);

				const pulledMeta = extractSkillMetadata(skillSrc);
				if (requirePinnedImage) {
					if (!pulledMeta.image) {
						return errorResult(`Artifact ${ref} SKILL.md is missing frontmatter image field.`);
					}
					const imageGuard = validatePinnedImage(pulledMeta.image);
					if (imageGuard) {
						return errorResult(`Artifact ${ref} image policy violation: ${imageGuard}`);
					}
				}

				const systemdDir = join(os.homedir(), ".config", "containers", "systemd");
				const userSystemdDir = join(os.homedir(), ".config", "systemd", "user");
				const skillDir = join(getBloomDir(), "Skills", params.name);
				mkdirSync(systemdDir, { recursive: true });
				mkdirSync(userSystemdDir, { recursive: true });
				mkdirSync(skillDir, { recursive: true });

				const networkDest = join(systemdDir, "bloom.network");
				if (!existsSync(networkDest) && existsSync(defaultNetworkPath)) {
					writeFileSync(networkDest, readFileSync(defaultNetworkPath));
				}

				for (const name of readdirSync(quadletSrc)) {
					const src = join(quadletSrc, name);
					if (!statSync(src).isFile()) continue;
					const destDir = name.endsWith(".socket") ? userSystemdDir : systemdDir;
					writeFileSync(join(destDir, name), readFileSync(src));
				}
				writeFileSync(join(skillDir, "SKILL.md"), readFileSync(skillSrc));

				const expectedSocket = join(quadletSrc, `bloom-${params.name}.socket`);
				const installedSocket = join(userSystemdDir, `bloom-${params.name}.socket`);
				if (!existsSync(expectedSocket) && existsSync(installedSocket)) {
					await run("systemctl", ["--user", "disable", "--now", `bloom-${params.name}.socket`], signal);
					rmSync(installedSocket, { force: true });
				}

				const tokenDir = join(os.homedir(), ".config", "bloom", "channel-tokens");
				mkdirSync(tokenDir, { recursive: true });
				const tokenPath = join(tokenDir, params.name);
				const tokenEnvPath = join(tokenDir, `${params.name}.env`);
				if (!existsSync(tokenPath)) {
					const token = randomBytes(32).toString("hex");
					writeFileSync(tokenPath, `${token}\n`);
					writeFileSync(tokenEnvPath, `BLOOM_CHANNEL_TOKEN=${token}\n`);
				}

				const daemonReload = await run("systemctl", ["--user", "daemon-reload"], signal);
				if (daemonReload.exitCode !== 0) return errorResult(`daemon-reload failed:\n${daemonReload.stderr}`);

				const socketUnit = join(userSystemdDir, `bloom-${params.name}.socket`);
				if (start) {
					const target = existsSync(socketUnit) ? `bloom-${params.name}.socket` : `bloom-${params.name}.service`;
					const startRes = await run("systemctl", ["--user", "start", target], signal);
					if (startRes.exitCode !== 0) {
						return errorResult(`Failed to start ${target}:\n${startRes.stderr}`);
					}
				}

				const meta = extractSkillMetadata(join(skillDir, "SKILL.md"));
				if (updateManifest) {
					const bloomDir = getBloomDir();
					const manifestPath = join(bloomDir, "manifest.yaml");
					const manifest = loadManifest(manifestPath);
					manifest.services[params.name] = {
						image: meta.image ?? "unknown",
						version: version === "latest" ? meta.version : version,
						enabled: true,
					};
					saveManifest(manifest, manifestPath, bloomDir);
				}

				return {
					content: [
						{
							type: "text" as const,
							text: sourceNote ? `Installed ${ref} successfully.\n${sourceNote}` : `Installed ${ref} successfully.`,
						},
					],
					details: {
						ref,
						resolvedDigest: resolvedDigest ?? null,
						installSource,
						sourceNote,
						start,
						manifestUpdated: updateManifest,
						installedTo: {
							systemdDir,
							userSystemdDir,
							skillDir,
						},
					},
				};
			} finally {
				rmSync(tempDir, { recursive: true, force: true });
			}
		},
	});

	pi.registerTool({
		name: "service_test",
		label: "Test Service",
		description: "Smoke-test installed service unit: reload, start, wait, inspect status/logs, optional cleanup.",
		promptSnippet: "service_test — run local smoke test for installed service",
		promptGuidelines: [
			"Use service_test before publishing a new service package.",
			"Check returned status and logs; fix issues before release.",
		],
		parameters: Type.Object({
			name: Type.String({ description: "Installed service name (e.g. whisper)" }),
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

			const start = await run("systemctl", ["--user", "start", startUnit], signal);
			if (start.exitCode !== 0) return errorResult(`Failed to start ${startUnit}:\n${start.stderr}`);

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

	pi.on("session_start", (_event, ctx) => {
		if (ctx.hasUI) {
			ctx.ui.setStatus("bloom-services", "Services: lifecycle tools ready");
		}
		log.info("service lifecycle extension loaded");
	});
}
