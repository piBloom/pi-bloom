/**
 * bloom-services — Service lifecycle: scaffold, install, test, and declarative manifest management.
 *
 * @tools service_scaffold, service_install, service_test, service_pair, manifest_show, manifest_sync, manifest_set_service, manifest_apply
 * @hooks session_start
 * @see {@link ../../AGENTS.md#bloom-services} Extension reference
 */
import os from "node:os";
import { join } from "node:path";
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { getBloomDir } from "../../lib/filesystem.js";
import {
	handleInstall,
	handleManifestApply,
	handleManifestSetService,
	handleManifestShow,
	handleManifestSync,
	handlePair,
	handleScaffold,
	handleSessionStart,
	handleTest,
} from "./actions.js";

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
			return handleScaffold(params, ctx);
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
			return handleInstall(params, bloomDir, manifestPath, repoDir, signal);
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
		async execute(_toolCallId, params, signal) {
			return handleTest(params, signal);
		},
	});

	pi.registerTool({
		name: "service_pair",
		label: "Pair Messaging Service",
		description:
			"Get connection details for Matrix homeserver. Returns homeserver URL, registration token, and QR code. Works with any Matrix client (Element, FluffyChat, etc.).",
		parameters: Type.Object({
			name: StringEnum(["element"] as const, {
				description: "Service to pair",
			}),
			timeout_sec: Type.Optional(Type.Number({ description: "Max seconds to wait for QR data", default: 60 })),
		}),
		async execute(_toolCallId, params, signal) {
			return handlePair(params, signal);
		},
	});

	// -----------------------------------------------------------------------
	// Manifest tools
	// -----------------------------------------------------------------------

	pi.registerTool({
		name: "manifest_show",
		label: "Show Manifest",
		description: "Display the declarative service manifest from ~/Bloom/manifest.yaml",
		parameters: Type.Object({}),
		async execute() {
			return handleManifestShow(manifestPath);
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
		async execute(_toolCallId, params, signal) {
			return handleManifestSync(params, manifestPath, signal);
		},
	});

	pi.registerTool({
		name: "manifest_set_service",
		label: "Set Manifest Service",
		description: "Add or update a service entry in the manifest.",
		parameters: Type.Object({
			name: Type.String({ description: "Service name (e.g. element, llm)" }),
			image: Type.String({ description: "Container image reference" }),
			version: Type.Optional(Type.String({ description: "Semver version tag" })),
			enabled: Type.Optional(Type.Boolean({ description: "Whether service should be running (default: true)" })),
		}),
		async execute(_toolCallId, params) {
			return handleManifestSetService(params, manifestPath);
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
			return handleManifestApply(params, bloomDir, manifestPath, repoDir, signal, ctx);
		},
	});

	// -----------------------------------------------------------------------
	// Session start hook (service status + manifest drift detection)
	// -----------------------------------------------------------------------

	pi.on("session_start", async (_event, ctx) => {
		return handleSessionStart(manifestPath, ctx);
	});
}
