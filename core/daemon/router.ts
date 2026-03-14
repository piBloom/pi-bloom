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
	targets: string[];
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
	if (envelope.senderKind === "self") {
		return { targets: [], reason: "ignored-self" };
	}

	if (hasProcessedEvent(state, envelope.eventId, envelope.timestamp)) {
		return { targets: [], reason: "ignored-duplicate" };
	}
	markEventProcessed(state, envelope.eventId, envelope.timestamp);

	const rootEventId = options.rootEventId ?? envelope.eventId;
	const totalReplyBudget = options.totalReplyBudget ?? 4;
	const hostAgent = agents.find((agent) => agent.respond.mode === "host");
	const hadExplicitMention = envelope.mentions.length > 0;
	const mentionedAgents = envelope.mentions.flatMap((userId) => {
		const agent = agents.find((candidate) => candidate.matrix.userId === userId);
		if (!agent || agent.respond.mode === "silent") return [];
		return [agent];
	});

	let initialTargets: AgentDefinition[] = [];
	let successReason: RouteDecision["reason"] = "ignored-policy";

	if (envelope.senderKind === "human") {
		if (hadExplicitMention) {
			initialTargets = mentionedAgents;
			if (initialTargets.length > 0) successReason = "explicit-mention";
		} else if (hostAgent) {
			initialTargets = [hostAgent];
			successReason = "host-default";
		}
	} else if (envelope.senderKind === "agent") {
		initialTargets = mentionedAgents.filter(
			(agent) => agent.id !== envelope.senderAgentId && agent.respond.allowAgentMentions,
		);
		if (initialTargets.length > 0) successReason = "agent-mention";
	}

	if (initialTargets.length === 0) {
		return { targets: [], reason: "ignored-policy" };
	}

	const budgetEligible = initialTargets.filter((agent) =>
		canReplyForRoot(
			state,
			envelope.roomId,
			rootEventId,
			agent.id,
			agent.respond.maxPublicTurnsPerRoot,
			totalReplyBudget,
			envelope.timestamp,
		),
	);
	if (budgetEligible.length === 0) {
		return { targets: [], reason: "ignored-budget" };
	}

	const cooldownEligible = budgetEligible.filter(
		(agent) => !isAgentCoolingDown(state, envelope.roomId, agent.id, envelope.timestamp, agent.respond.cooldownMs),
	);
	if (cooldownEligible.length === 0) {
		return { targets: [], reason: "ignored-cooldown" };
	}

	for (const agent of cooldownEligible) {
		markReplySent(state, envelope.roomId, rootEventId, agent.id, envelope.timestamp);
	}

	return {
		targets: cooldownEligible.map((agent) => agent.id),
		reason: successReason,
	};
}
