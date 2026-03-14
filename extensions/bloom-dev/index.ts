/**
 * bloom-dev — On-device development tools: enable dev mode, code-server, local builds, testing, PR submission.
 *
 * @tools dev_enable, dev_disable, dev_status, dev_code_server, dev_build, dev_switch, dev_rollback, dev_loop, dev_test, dev_submit_pr, dev_push_skill, dev_push_service, dev_push_extension, dev_install_package
 * @see {@link ../../AGENTS.md#bloom-dev} Extension reference
 */
import os from "node:os";
import { join } from "node:path";
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { errorResult } from "../../core/lib/shared.js";
import { handleDevBuild, handleDevLoop, handleDevRollback, handleDevSwitch } from "./actions-build.js";
import {
	handleDevCodeServer,
	handleDevDisable,
	handleDevEnable,
	handleDevStatus,
	isDevEnabled,
} from "./actions-lifecycle.js";
import {
	handleDevInstallPackage,
	handleDevPushExtension,
	handleDevPushService,
	handleDevPushSkill,
	handleDevSubmitPr,
	handleDevTest,
} from "./actions-pr.js";

const bloomRuntime = join(os.homedir(), ".bloom");

/** Gate helper: returns an error result if dev mode is not enabled. */
function devGate(): ReturnType<typeof errorResult> | null {
	if (!isDevEnabled(bloomRuntime)) {
		return errorResult("Dev mode is not enabled. Run dev_enable first.");
	}
	return null;
}

export default function (pi: ExtensionAPI) {
	const repoDir = join(bloomRuntime, "pi-bloom");

	// --- Always registered (no gate) ---

	pi.registerTool({
		name: "dev_enable",
		label: "Enable Dev Mode",
		description: "Enable on-device development mode by writing the dev sentinel file.",
		parameters: Type.Object({}),
		async execute() {
			return handleDevEnable(bloomRuntime);
		},
	});

	pi.registerTool({
		name: "dev_disable",
		label: "Disable Dev Mode",
		description: "Disable on-device development mode by removing the dev sentinel file.",
		parameters: Type.Object({}),
		async execute() {
			return handleDevDisable(bloomRuntime);
		},
	});

	pi.registerTool({
		name: "dev_status",
		label: "Dev Status",
		description: "Check the current development environment status: dev mode, repo, code-server, local build.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, signal) {
			return handleDevStatus(bloomRuntime, signal);
		},
	});

	// --- Dev-mode gated tools ---

	pi.registerTool({
		name: "dev_code_server",
		label: "Code Server",
		description: "Start or stop the code-server development environment.",
		parameters: Type.Object({
			action: StringEnum(["start", "stop", "restart", "status"] as const, {
				description:
					"start: launch code-server. stop: shut it down. restart: reload and restart. status: check if running.",
			}),
		}),
		async execute(_toolCallId, params, signal) {
			const gate = devGate();
			if (gate) return gate;
			return handleDevCodeServer(params.action, signal);
		},
	});

	pi.registerTool({
		name: "dev_build",
		label: "Dev Build",
		description: "Build a local container image from the Bloom repo.",
		parameters: Type.Object({
			tag: Type.Optional(Type.String({ description: "Image tag (default: localhost/bloom:dev)" })),
		}),
		async execute(_toolCallId, params, signal) {
			const gate = devGate();
			if (gate) return gate;
			return handleDevBuild(repoDir, signal, params.tag);
		},
	});

	pi.registerTool({
		name: "dev_switch",
		label: "Dev Switch",
		description: "Switch the running OS to a local or remote container image.",
		parameters: Type.Object({
			image_ref: Type.String({ description: "Image reference to switch to (e.g. localhost/bloom:dev)" }),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const gate = devGate();
			if (gate) return gate;
			return handleDevSwitch(params.image_ref, signal, ctx);
		},
	});

	pi.registerTool({
		name: "dev_rollback",
		label: "Dev Rollback",
		description: "Rollback to the previous OS deployment.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, signal, _onUpdate, ctx) {
			const gate = devGate();
			if (gate) return gate;
			return handleDevRollback(signal, ctx);
		},
	});

	pi.registerTool({
		name: "dev_loop",
		label: "Dev Loop",
		description: "Run the edit-build-switch development loop: build local image, switch to it, reboot.",
		parameters: Type.Object({
			tag: Type.Optional(Type.String({ description: "Image tag (default: localhost/bloom:dev)" })),
			skip_reboot: Type.Optional(Type.Boolean({ description: "If true, stage the switch but skip automatic reboot" })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const gate = devGate();
			if (gate) return gate;
			return handleDevLoop(params, signal, ctx, repoDir);
		},
	});

	pi.registerTool({
		name: "dev_test",
		label: "Dev Test",
		description: "Run tests and linting against the local Bloom repo.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, signal) {
			const gate = devGate();
			if (gate) return gate;
			return handleDevTest(repoDir, signal);
		},
	});

	pi.registerTool({
		name: "dev_submit_pr",
		label: "Dev Submit PR",
		description: "Submit a pull request from local repo changes to upstream.",
		parameters: Type.Object({
			title: Type.String({ description: "Pull request title" }),
			body: Type.Optional(Type.String({ description: "Pull request body markdown" })),
			branch: Type.Optional(Type.String({ description: "Branch name (auto-generated from title if omitted)" })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const gate = devGate();
			if (gate) return gate;
			return handleDevSubmitPr(params, repoDir, signal, ctx);
		},
	});

	pi.registerTool({
		name: "dev_push_skill",
		label: "Push Skill",
		description: "Push a skill from ~/Bloom/Skills/ into the repo and open a PR.",
		parameters: Type.Object({
			skill_name: Type.String({ description: "Name of the skill to push" }),
			title: Type.Optional(Type.String({ description: "PR title (auto-generated if omitted)" })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const gate = devGate();
			if (gate) return gate;
			return handleDevPushSkill(params, repoDir, signal, ctx);
		},
	});

	pi.registerTool({
		name: "dev_push_service",
		label: "Push Service",
		description: "Push a service into the repo and open a PR.",
		parameters: Type.Object({
			service_name: Type.String({ description: "Name of the service to push" }),
			title: Type.Optional(Type.String({ description: "PR title (auto-generated if omitted)" })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const gate = devGate();
			if (gate) return gate;
			return handleDevPushService(params, repoDir, signal, ctx);
		},
	});

	pi.registerTool({
		name: "dev_push_extension",
		label: "Push Extension",
		description: "Push an extension into the repo and open a PR.",
		parameters: Type.Object({
			extension_name: Type.String({ description: "Name of the extension to push" }),
			source_path: Type.Optional(
				Type.String({
					description:
						"Optional extension path inside ~/Bloom/extensions/ (absolute paths must still resolve under that root)",
				}),
			),
			title: Type.Optional(Type.String({ description: "PR title (auto-generated if omitted)" })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const gate = devGate();
			if (gate) return gate;
			return handleDevPushExtension(params, repoDir, signal, ctx);
		},
	});

	pi.registerTool({
		name: "dev_install_package",
		label: "Install Package",
		description: "Install a Pi package from a local path or URL (falls back to local scope on immutable systems).",
		parameters: Type.Object({
			source: Type.String({ description: "Local path to the Pi package directory or URL" }),
		}),
		async execute(_toolCallId, params, signal) {
			const gate = devGate();
			if (gate) return gate;
			return handleDevInstallPackage(params, signal);
		},
	});
}
