/**
 * bloom-topics — Conversation topic management and session organization.
 *
 * @commands /topic (new | close | list | switch)
 * @hooks session_start, before_agent_start
 * @see {@link ../../AGENTS.md#bloom-topics} Extension reference
 */
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { buildTopicGuidance, handleTopicCommand } from "./actions.js";

export default function (pi: ExtensionAPI) {
	let lastCtx: ExtensionContext | null = null;

	pi.on("session_start", (_event, ctx) => {
		lastCtx = ctx;
	});

	pi.on("before_agent_start", async (event) => {
		return { systemPrompt: event.systemPrompt + buildTopicGuidance() };
	});

	pi.registerCommand("topic", {
		description: "Manage conversation topics: /topic new <name> | close | list | switch <name>",
		handler: async (args: string, ctx) => {
			lastCtx = ctx;
			const result = handleTopicCommand(args, lastCtx);

			switch (result.action) {
				case "notify": {
					ctx.ui.notify(result.message, result.level);
					break;
				}
				case "start": {
					const leaf = ctx.sessionManager.getLeafEntry();
					const branchPoint = leaf?.id;
					pi.appendEntry("bloom-topic", { name: result.name, status: "active", branchPoint });
					ctx.ui.notify(result.message, "info");
					pi.sendUserMessage(
						`We are now focusing on a new topic: "${result.name}". Please keep your responses focused on this topic until it is closed.`,
						{ deliverAs: "followUp" },
					);
					break;
				}
				case "close": {
					pi.appendEntry("bloom-topic", {
						name: result.name,
						status: "closed",
						branchPoint: result.branchPoint,
					});
					ctx.ui.notify(result.message, "info");
					pi.sendUserMessage(
						`The topic "${result.name}" is now closed. Please summarize what was discussed and accomplished, then return to the main conversation.`,
						{ deliverAs: "followUp" },
					);
					break;
				}
				case "list": {
					const lines = result.topics.map(
						(t) => `${t.status === "active" ? "* " : "  "}${t.name} [${t.status}]`,
					);
					ctx.ui.notify(lines.join("\n"), "info");
					break;
				}
				case "switch": {
					if (result.branchPoint) {
						const navResult = await ctx.navigateTree(result.branchPoint, {
							summarize: true,
							label: `topic: ${result.name}`,
						});
						if (navResult.cancelled) {
							ctx.ui.notify(`Switch to topic "${result.name}" was cancelled.`, "warning");
							return;
						}
					}
					pi.appendEntry("bloom-topic", {
						name: result.name,
						status: "active",
						branchPoint: result.branchPoint,
					});
					ctx.ui.notify(`Switched to topic: ${result.name}`, "info");
					break;
				}
			}
		},
	});
}
