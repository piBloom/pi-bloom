/**
 * nixpi — NixPI directory bootstrap, status, and blueprint seeding.
 *
 * @tools nixpi_status
 * @commands /nixpi (init | status | update-blueprints)
 * @hooks session_start, resources_discover
 * @see {@link ../../AGENTS.md#nixpi} Extension reference
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getNixPiDir } from "../../../lib/filesystem.js";
import { EmptyToolParams, type RegisteredExtensionTool, registerTools } from "../../../lib/utils.js";
import { discoverSkillPaths, ensureNixPi, getPackageDir, handleNixPiStatus } from "./actions.js";
import { handleUpdateBlueprints, readBlueprintVersions, seedBlueprints } from "./actions-blueprints.js";

type NixPiCommandContext = Parameters<Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]>[1];

export default function (pi: ExtensionAPI) {
	const nixPiDir = getNixPiDir();
	const packageDir = getPackageDir();
	const tools: RegisteredExtensionTool[] = [
		{
			name: "nixpi_status",
			label: "NixPI Status",
			description: "Show NixPI directory location and blueprint state",
			parameters: EmptyToolParams,
			async execute() {
				return handleNixPiStatus(nixPiDir);
			},
		},
	];
	registerTools(pi, tools);

	pi.on("session_start", (_event, ctx) => {
		ensureNixPi(nixPiDir);
		seedBlueprints(nixPiDir, packageDir);

		const versions = readBlueprintVersions(nixPiDir);
		const updates = Object.keys(versions.updatesAvailable);
		if (ctx.hasUI) {
			if (updates.length > 0) {
				ctx.ui.setWidget("nixpi-updates", [
					`${updates.length} blueprint update(s) available — /nixpi update-blueprints`,
				]);
			}
			ctx.ui.setStatus("nixpi", `NixPI: ${nixPiDir}`);
		}
	});

	pi.registerCommand("nixpi", {
		description: "NixPI directory management: /nixpi init | status | update-blueprints",
		handler: async (args: string, ctx) => handleNixPiCommand(pi, nixPiDir, packageDir, args, ctx),
	});

	pi.on("resources_discover", () => {
		const paths = discoverSkillPaths(nixPiDir);
		if (paths) return { skillPaths: paths };
	});
}

async function handleNixPiCommand(
	pi: ExtensionAPI,
	nixPiDir: string,
	packageDir: string,
	args: string,
	ctx: NixPiCommandContext,
): Promise<void> {
	const subcommand = args.trim().split(/\s+/)[0] ?? "";
	if (!subcommand) {
		ctx.ui.notify("Usage: /nixpi init | status | update-blueprints", "info");
		return;
	}

	switch (subcommand) {
		case "init":
			ensureNixPi(nixPiDir);
			seedBlueprints(nixPiDir, packageDir);
			ctx.ui.notify("NixPI initialized", "info");
			return;
		case "status":
			pi.sendUserMessage("Show nixpi status using the nixpi_status tool.", { deliverAs: "followUp" });
			return;
		case "update-blueprints": {
			const count = handleUpdateBlueprints(nixPiDir, packageDir);
			ctx.ui.notify(count === 0 ? "All blueprints are up to date" : `Updated ${count} blueprint(s)`, "info");
			return;
		}
		default:
			ctx.ui.notify("Usage: /nixpi init | status | update-blueprints", "info");
	}
}
