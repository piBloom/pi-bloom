import path from "node:path";
/**
 * bloom-episodes — Append-only episodic memory in ~/Bloom/Episodes/.
 *
 * @tools episode_create, episode_list, episode_promote, episode_consolidate
 * @see {@link ../../AGENTS.md#bloom-episodes} Extension reference
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { defineTool, type RegisteredExtensionTool, registerTools } from "../../lib/extension-tools.js";
import { truncate } from "../../lib/shared.js";
import { consolidateEpisodes, createEpisode, listEpisodes, promoteEpisode } from "./actions.js";

type EpisodeCreateParams = Parameters<typeof createEpisode>[0] & {
	promote_to?: Parameters<typeof promoteEpisode>[0]["target"];
};
type EpisodeListParams = Parameters<typeof listEpisodes>[0];
type EpisodePromoteParams = Parameters<typeof promoteEpisode>[0];
type EpisodeConsolidateParams = Parameters<typeof consolidateEpisodes>[0];

function projectNameFromCtx(ctx: { cwd?: string } | undefined): string | undefined {
	if (!ctx?.cwd) return undefined;
	const name = path.basename(ctx.cwd);
	return name || undefined;
}

export default function (pi: ExtensionAPI) {
	const tools: RegisteredExtensionTool[] = [
		defineTool({
			name: "episode_create",
			label: "Episode Create",
			description: "Append a markdown episode under ~/Bloom/Episodes/ for later memory consolidation.",
			parameters: Type.Object({
				title: Type.String({ description: "Short episode title" }),
				body: Type.String({ description: "Markdown body for the episode" }),
				kind: Type.Optional(
					Type.String({ description: "Episode kind (e.g. observation, tool-result, decision-point)" }),
				),
				room: Type.Optional(Type.String({ description: "Optional room identifier" })),
				agent: Type.Optional(Type.String({ description: "Optional agent identifier" })),
				importance: Type.Optional(Type.String({ description: "Importance hint: low, medium, high" })),
				tags: Type.Optional(Type.Array(Type.String({ description: "Episode tags" }))),
				derived_objects: Type.Optional(
					Type.Array(Type.String({ description: "Related durable refs like preference/foo" })),
				),
				promote_to: Type.Optional(
					Type.Object({
						type: Type.String({
							description: "Durable target type: fact, preference, decision, procedure, project",
						}),
						slug: Type.String({ description: "Durable target slug" }),
						title: Type.Optional(Type.String({ description: "Optional durable title override" })),
						summary: Type.Optional(Type.String({ description: "Optional durable summary override" })),
						scope: Type.Optional(Type.String({ description: "Durable scope override" })),
						scope_value: Type.Optional(Type.String({ description: "Concrete scope value override" })),
						confidence: Type.Optional(Type.String({ description: "Durable confidence override" })),
						status: Type.Optional(Type.String({ description: "Durable status override" })),
						salience: Type.Optional(Type.Number({ description: "Durable salience override" })),
						tags: Type.Optional(Type.Array(Type.String({ description: "Durable tags override" }))),
					}),
				),
			}),
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const typedParams = params as EpisodeCreateParams;
				const episodeResult = createEpisode(typedParams);
				if (("isError" in episodeResult && episodeResult.isError) || !typedParams.promote_to) {
					return episodeResult;
				}
				const promotion = promoteEpisode({
					episode_id: String((episodeResult.details as { id: string }).id),
					target: typedParams.promote_to,
					mode: "upsert",
					projectName: projectNameFromCtx(ctx),
				});
				if ("isError" in promotion && promotion.isError) return promotion;
				return {
					content: [
						{
							type: "text" as const,
							text: `${episodeResult.content[0]?.text}\n${promotion.content[0]?.text}`,
						},
					],
					details: {
						...episodeResult.details,
						promotion: promotion.details,
					},
				};
			},
		}),
		defineTool({
			name: "episode_list",
			label: "Episode List",
			description: "List stored markdown episodes under ~/Bloom/Episodes/.",
			parameters: Type.Object({
				day: Type.Optional(Type.String({ description: "Optional day filter in YYYY-MM-DD" })),
				kind: Type.Optional(Type.String({ description: "Optional episode kind filter" })),
				limit: Type.Optional(Type.Number({ description: "Max results to return", default: 20 })),
			}),
			async execute(_toolCallId, params) {
				const matches = listEpisodes(params as EpisodeListParams);
				const text = matches.length > 0 ? matches.join("\n") : "No episodes found";
				return {
					content: [{ type: "text" as const, text: truncate(text) }],
					details: { count: matches.length },
				};
			},
		}),
		defineTool({
			name: "episode_promote",
			label: "Episode Promote",
			description: "Promote a stored episode into a durable memory object in ~/Bloom/Objects/.",
			parameters: Type.Object({
				episode_id: Type.String({ description: "Episode id, e.g. 2026-03-14T10-12-33Z-room-abc" }),
				mode: Type.Optional(Type.Union([Type.Literal("upsert"), Type.Literal("create")])),
				target: Type.Object({
					type: Type.String({ description: "Durable target type: fact, preference, decision, procedure, project" }),
					slug: Type.String({ description: "Durable target slug" }),
					title: Type.Optional(Type.String({ description: "Optional durable title override" })),
					summary: Type.Optional(Type.String({ description: "Optional durable summary override" })),
					scope: Type.Optional(Type.String({ description: "Durable scope override" })),
					scope_value: Type.Optional(Type.String({ description: "Concrete scope value override" })),
					confidence: Type.Optional(Type.String({ description: "Durable confidence override" })),
					status: Type.Optional(Type.String({ description: "Durable status override" })),
					salience: Type.Optional(Type.Number({ description: "Durable salience override" })),
					tags: Type.Optional(Type.Array(Type.String({ description: "Durable tags override" }))),
				}),
			}),
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const typedParams = params as EpisodePromoteParams;
				return promoteEpisode({
					episode_id: typedParams.episode_id,
					target: typedParams.target,
					mode: typedParams.mode,
					projectName: projectNameFromCtx(ctx),
				});
			},
		}),
		defineTool({
			name: "episode_consolidate",
			label: "Episode Consolidate",
			description: "Propose or apply conservative promotion candidates from recent episodes.",
			parameters: Type.Object({
				mode: Type.Optional(Type.Union([Type.Literal("propose"), Type.Literal("apply")])),
				day: Type.Optional(Type.String({ description: "Optional day filter in YYYY-MM-DD" })),
				kind: Type.Optional(Type.String({ description: "Optional episode kind filter" })),
				limit: Type.Optional(Type.Number({ description: "Max episodes to scan", default: 20 })),
			}),
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const typedParams = params as EpisodeConsolidateParams;
				return consolidateEpisodes({ ...typedParams, projectName: projectNameFromCtx(ctx) });
			},
		}),
	];
	registerTools(pi, tools);
}
