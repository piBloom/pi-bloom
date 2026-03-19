/**
 * bloom-garden — Bloom directory bootstrap, status, and blueprint seeding.
 *
 * @tools garden_status
 * @commands /bloom (init | status | update-blueprints)
 * @hooks session_start, resources_discover
 * @see {@link ../../AGENTS.md#bloom-garden} Extension reference
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { defineTool, type RegisteredExtensionTool, registerTools } from "../../lib/extension-tools.js";
import { getBloomDir } from "../../lib/filesystem.js";
import { discoverSkillPaths, ensureBloom, getPackageDir, handleGardenStatus } from "./actions.js";
import { handleUpdateBlueprints, readBlueprintVersions, seedBlueprints } from "./actions-blueprints.js";

type BloomCommandContext = Parameters<Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]>[1];

export default function (pi: ExtensionAPI) {
	const bloomDir = getBloomDir();
	const packageDir = getPackageDir();
	const tools: RegisteredExtensionTool[] = [
		defineTool({
			name: "garden_status",
			label: "Bloom Status",
			description: "Show Bloom directory location and blueprint state",
			parameters: Type.Object({}),
			async execute() {
				return handleGardenStatus(bloomDir);
			},
		}),
	];
	registerTools(pi, tools);

	pi.on("session_start", (_event, ctx) => {
		ensureBloom(bloomDir);
		seedBlueprints(bloomDir, packageDir);

		const versions = readBlueprintVersions(bloomDir);
		const updates = Object.keys(versions.updatesAvailable);
		if (ctx.hasUI) {
			if (updates.length > 0) {
				ctx.ui.setWidget("bloom-updates", [
					`${updates.length} blueprint update(s) available — /bloom update-blueprints`,
				]);
			}
			ctx.ui.setStatus("bloom-garden", `Bloom: ${bloomDir}`);
		}
	});

	pi.registerCommand("bloom", {
		description: "Bloom directory management: /bloom init | status | update-blueprints",
		handler: async (args: string, ctx) => handleBloomCommand(pi, bloomDir, packageDir, args, ctx),
	});

	pi.on("resources_discover", () => {
		const paths = discoverSkillPaths(bloomDir);
		if (paths) return { skillPaths: paths };
	});
}

async function handleBloomCommand(
	pi: ExtensionAPI,
	bloomDir: string,
	packageDir: string,
	args: string,
	ctx: BloomCommandContext,
): Promise<void> {
	const subcommand = args.trim().split(/\s+/)[0] ?? "";
	if (!subcommand) {
		ctx.ui.notify("Usage: /bloom init | status | update-blueprints", "info");
		return;
	}

	switch (subcommand) {
		case "init":
			ensureBloom(bloomDir);
			seedBlueprints(bloomDir, packageDir);
			ctx.ui.notify("Bloom initialized", "info");
			return;
		case "status":
			pi.sendUserMessage("Show bloom status using the garden_status tool.", { deliverAs: "followUp" });
			return;
		case "update-blueprints": {
			const count = handleUpdateBlueprints(bloomDir, packageDir);
			ctx.ui.notify(count === 0 ? "All blueprints are up to date" : `Updated ${count} blueprint(s)`, "info");
			return;
		}
		default:
			ctx.ui.notify("Usage: /bloom init | status | update-blueprints", "info");
	}
}
