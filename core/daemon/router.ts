import type { AgentDefinition } from "./agent-registry.js";
import {
	canReplyForRoot,
	hasProcessedEvent,
	isAgentCoolingDown,
	markEventProcessed,
	markReplySent,
	type RoomState,
} from "./room-state.js";

export interface RoomEnvelope {
	roomId: string;
	eventId: string;
	senderUserId: string;
	body: string;
	senderKind: "human" | "agent" | "self" | "unknown";
	senderAgentId?: string;
	mentions: string[];
	timestamp: number;
}

export interface RouteDecision {
	targets: [string] | [];
	reason:
		| "host-default"
		| "explicit-mention"
		| "agent-mention"
		| "ignored-self"
		| "ignored-duplicate"
		| "ignored-policy"
		| "ignored-budget"
		| "ignored-cooldown";
}

export interface RouteOptions {
	rootEventId?: string;
	totalReplyBudget?: number;
}

interface InitialTargetDecision {
	targets: [AgentDefinition] | [];
	reason: RouteDecision["reason"];
}

export function extractMentions(body: string, agents: readonly AgentDefinition[]): string[] {
	return agents
		.map((agent) => ({ userId: agent.matrix.userId, index: body.indexOf(agent.matrix.userId) }))
		.filter((hit) => hit.index >= 0)
		.sort((left, right) => left.index - right.index)
		.map((hit) => hit.userId);
}

export function classifySender(
	senderUserId: string,
	selfUserId: string,
	agents: readonly AgentDefinition[],
): { senderKind: RoomEnvelope["senderKind"]; senderAgentId?: string } {
	if (senderUserId === selfUserId) return { senderKind: "self" };
	const agent = agents.find((candidate) => candidate.matrix.userId === senderUserId);
	if (agent) return { senderKind: "agent", senderAgentId: agent.id };
	if (/^@[a-zA-Z0-9._=\-/]+:[a-zA-Z0-9.-]+$/.test(senderUserId)) return { senderKind: "human" };
	return { senderKind: "unknown" };
}

export function routeRoomEnvelope(
	envelope: RoomEnvelope,
	agents: readonly AgentDefinition[],
	state: RoomState,
	options: RouteOptions = {},
): RouteDecision {
	const ignoredReason = getIgnoredReason(envelope, state);
	if (ignoredReason) return { targets: [], reason: ignoredReason };

	const rootEventId = options.rootEventId ?? envelope.eventId;
	const totalReplyBudget = options.totalReplyBudget ?? 4;
	const initialDecision = getInitialTargetDecision(envelope, agents);
	if (initialDecision.targets.length === 0) return { targets: [], reason: "ignored-policy" };

	const [targetAgent] = initialDecision.targets;
	if (!targetAgent) {
		return { targets: [], reason: "ignored-policy" };
	}

	const canReply = canReplyForRoot(
		state,
		envelope.roomId,
		rootEventId,
		targetAgent.id,
		targetAgent.respond.maxPublicTurnsPerRoot,
		totalReplyBudget,
		envelope.timestamp,
	);
	if (!canReply) {
		return { targets: [], reason: "ignored-budget" };
	}

	if (isAgentCoolingDown(state, envelope.roomId, targetAgent.id, envelope.timestamp, targetAgent.respond.cooldownMs)) {
		return { targets: [], reason: "ignored-cooldown" };
	}

	markReplySent(state, envelope.roomId, rootEventId, targetAgent.id, envelope.timestamp);

	return {
		targets: [targetAgent.id],
		reason: initialDecision.reason,
	};
}

function getIgnoredReason(
	envelope: RoomEnvelope,
	state: RoomState,
): Extract<RouteDecision["reason"], "ignored-self" | "ignored-duplicate"> | undefined {
	if (envelope.senderKind === "self") return "ignored-self";
	if (hasProcessedEvent(state, envelope.eventId, envelope.timestamp)) return "ignored-duplicate";
	markEventProcessed(state, envelope.eventId, envelope.timestamp);
	return undefined;
}

function getInitialTargetDecision(envelope: RoomEnvelope, agents: readonly AgentDefinition[]): InitialTargetDecision {
	const mentionedAgents = getMentionedAgents(envelope.mentions, agents);
	if (envelope.senderKind === "human") {
		return getHumanTargetDecision(envelope.mentions.length > 0, mentionedAgents, agents);
	}
	if (envelope.senderKind === "agent") {
		return getAgentTargetDecision(envelope.senderAgentId, mentionedAgents);
	}
	return { targets: [], reason: "ignored-policy" };
}

function getMentionedAgents(mentions: readonly string[], agents: readonly AgentDefinition[]): AgentDefinition[] {
	return mentions.flatMap((userId) => {
		const agent = agents.find((candidate) => candidate.matrix.userId === userId);
		if (!agent || agent.respond.mode === "silent") return [];
		return [agent];
	});
}

function getHumanTargetDecision(
	hadExplicitMention: boolean,
	mentionedAgents: readonly AgentDefinition[],
	agents: readonly AgentDefinition[],
): InitialTargetDecision {
	if (hadExplicitMention && mentionedAgents.length > 0) {
		const [firstMentionedAgent] = mentionedAgents;
		return firstMentionedAgent
			? { targets: [firstMentionedAgent], reason: "explicit-mention" }
			: { targets: [], reason: "ignored-policy" };
	}

	const hostAgent = agents.find((agent) => agent.respond.mode === "host");
	if (hadExplicitMention || !hostAgent) return { targets: [], reason: "ignored-policy" };
	return { targets: [hostAgent], reason: "host-default" };
}

function getAgentTargetDecision(
	senderAgentId: string | undefined,
	mentionedAgents: readonly AgentDefinition[],
): InitialTargetDecision {
	const target = mentionedAgents.find((agent) => agent.id !== senderAgentId && agent.respond.allowAgentMentions);
	if (!target) return { targets: [], reason: "ignored-policy" };
	return { targets: [target], reason: "agent-mention" };
}
