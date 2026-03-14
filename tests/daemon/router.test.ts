import { describe, expect, it } from "vitest";

import type { AgentDefinition } from "../../core/daemon/agent-registry.js";
import { createRoomState } from "../../core/daemon/room-state.js";
import { classifySender, extractMentions, routeRoomEnvelope } from "../../core/daemon/router.js";

function makeAgent(id: string, userId: string, mode: AgentDefinition["respond"]["mode"]): AgentDefinition {
	return {
		id,
		name: id[0]?.toUpperCase() + id.slice(1),
		instructionsPath: `/tmp/${id}/AGENTS.md`,
		instructionsBody: `# ${id}`,
		matrix: {
			username: userId.slice(1, userId.indexOf(":")),
			userId,
			autojoin: true,
		},
		respond: {
			mode,
			allowAgentMentions: true,
			maxPublicTurnsPerRoot: 2,
			cooldownMs: 1500,
		},
	};
}

const host = makeAgent("host", "@pi:bloom", "host");
const planner = makeAgent("planner", "@planner:bloom", "mentioned");
const critic = makeAgent("critic", "@critic:bloom", "mentioned");
const silent = makeAgent("silent", "@silent:bloom", "silent");
const agents = [host, planner, critic, silent];

describe("extractMentions", () => {
	it("finds explicit Matrix user id mentions", () => {
		expect(extractMentions("hey @planner:bloom and @critic:bloom", agents)).toEqual([
			"@planner:bloom",
			"@critic:bloom",
		]);
	});

	it("preserves mention order from the message body instead of agent registry order", () => {
		const registryOrderedAgents = [critic, host, planner, silent];
		expect(extractMentions("@planner:bloom first, then @critic:bloom", registryOrderedAgents)).toEqual([
			"@planner:bloom",
			"@critic:bloom",
		]);
	});

	it("does not return duplicate mentions", () => {
		expect(extractMentions("@planner:bloom @planner:bloom", agents)).toEqual(["@planner:bloom"]);
	});
});

describe("classifySender", () => {
	it("classifies self messages", () => {
		expect(classifySender("@pi:bloom", "@pi:bloom", agents)).toEqual({ senderKind: "self" });
	});

	it("classifies known agents", () => {
		expect(classifySender("@planner:bloom", "@pi:bloom", agents)).toEqual({
			senderKind: "agent",
			senderAgentId: "planner",
		});
	});

	it("classifies non-agent users as human", () => {
		expect(classifySender("@alex:bloom", "@pi:bloom", agents)).toEqual({ senderKind: "human" });
	});
});

describe("routeRoomEnvelope", () => {
	it("routes human messages without mentions to the host agent", () => {
		const state = createRoomState();
		const result = routeRoomEnvelope(
			{
				roomId: "!room:bloom",
				eventId: "$evt1",
				senderUserId: "@alex:bloom",
				body: "hello there",
				senderKind: "human",
				mentions: [],
				timestamp: 1_000,
			},
			agents,
			state,
		);

		expect(result).toEqual({ targets: ["host"], reason: "host-default" });
	});

	it("routes explicit human mentions only to the mentioned agents", () => {
		const state = createRoomState();
		const result = routeRoomEnvelope(
			{
				roomId: "!room:bloom",
				eventId: "$evt2",
				senderUserId: "@alex:bloom",
				body: "@planner:bloom help me",
				senderKind: "human",
				mentions: ["@planner:bloom"],
				timestamp: 1_000,
			},
			agents,
			state,
		);

		expect(result).toEqual({ targets: ["planner"], reason: "explicit-mention" });
	});

	it("routes multiple explicit mentions to multiple agents in mention order", () => {
		const state = createRoomState();
		const result = routeRoomEnvelope(
			{
				roomId: "!room:bloom",
				eventId: "$evt3",
				senderUserId: "@alex:bloom",
				body: "@planner:bloom and @critic:bloom weigh in",
				senderKind: "human",
				mentions: ["@planner:bloom", "@critic:bloom"],
				timestamp: 1_000,
			},
			agents,
			state,
		);

		expect(result).toEqual({ targets: ["planner", "critic"], reason: "explicit-mention" });
	});

	it("never auto-targets silent agents", () => {
		const state = createRoomState();
		const result = routeRoomEnvelope(
			{
				roomId: "!room:bloom",
				eventId: "$evt4",
				senderUserId: "@alex:bloom",
				body: "@silent:bloom speak",
				senderKind: "human",
				mentions: ["@silent:bloom"],
				timestamp: 1_000,
			},
			agents,
			state,
		);

		expect(result).toEqual({ targets: [], reason: "ignored-policy" });
	});

	it("requires explicit mention for agent-to-agent routing", () => {
		const state = createRoomState();
		const result = routeRoomEnvelope(
			{
				roomId: "!room:bloom",
				eventId: "$evt5",
				senderUserId: "@planner:bloom",
				body: "I have thoughts",
				senderKind: "agent",
				senderAgentId: "planner",
				mentions: [],
				timestamp: 1_000,
			},
			agents,
			state,
		);

		expect(result).toEqual({ targets: [], reason: "ignored-policy" });
	});

	it("allows agent-to-agent routing when a peer agent is explicitly mentioned", () => {
		const state = createRoomState();
		const result = routeRoomEnvelope(
			{
				roomId: "!room:bloom",
				eventId: "$evt6",
				senderUserId: "@planner:bloom",
				body: "@critic:bloom please review",
				senderKind: "agent",
				senderAgentId: "planner",
				mentions: ["@critic:bloom"],
				timestamp: 1_000,
			},
			agents,
			state,
		);

		expect(result).toEqual({ targets: ["critic"], reason: "agent-mention" });
	});

	it("rejects duplicate event ids", () => {
		const state = createRoomState();
		const envelope = {
			roomId: "!room:bloom",
			eventId: "$evt7",
			senderUserId: "@alex:bloom",
			body: "hello",
			senderKind: "human" as const,
			mentions: [],
			timestamp: 1_000,
		};

		expect(routeRoomEnvelope(envelope, agents, state)).toEqual({
			targets: ["host"],
			reason: "host-default",
		});
		expect(routeRoomEnvelope(envelope, agents, state)).toEqual({
			targets: [],
			reason: "ignored-duplicate",
		});
	});

	it("blocks rapid repeat replies during cooldown", () => {
		const state = createRoomState();
		expect(
			routeRoomEnvelope(
				{
					roomId: "!room:bloom",
					eventId: "$evt8",
					senderUserId: "@alex:bloom",
					body: "hello",
					senderKind: "human",
					mentions: [],
					timestamp: 10_000,
				},
				agents,
				state,
			),
		).toEqual({ targets: ["host"], reason: "host-default" });

		expect(
			routeRoomEnvelope(
				{
					roomId: "!room:bloom",
					eventId: "$evt9",
					senderUserId: "@alex:bloom",
					body: "hello again",
					senderKind: "human",
					mentions: [],
					timestamp: 10_500,
				},
				agents,
				state,
			),
		).toEqual({ targets: [], reason: "ignored-cooldown" });
	});

	it("blocks replies when the per-root budget is exhausted", () => {
		const state = createRoomState();
		const baseEnvelope = {
			roomId: "!room:bloom",
			senderUserId: "@alex:bloom",
			body: "@planner:bloom help",
			senderKind: "human" as const,
			mentions: ["@planner:bloom"],
		};

		expect(
			routeRoomEnvelope({ ...baseEnvelope, eventId: "$evt10", timestamp: 20_000 }, agents, state, {
				rootEventId: "$root1",
			}),
		).toEqual({ targets: ["planner"], reason: "explicit-mention" });
		expect(
			routeRoomEnvelope({ ...baseEnvelope, eventId: "$evt11", timestamp: 22_000 }, agents, state, {
				rootEventId: "$root1",
			}),
		).toEqual({ targets: ["planner"], reason: "explicit-mention" });
		expect(
			routeRoomEnvelope({ ...baseEnvelope, eventId: "$evt12", timestamp: 24_000 }, agents, state, {
				rootEventId: "$root1",
			}),
		).toEqual({ targets: [], reason: "ignored-budget" });
	});
});
