import { describe, expect, it, vi } from "vitest";

import type { AgentDefinition } from "../../core/daemon/agent-registry.js";
import { AgentSupervisor } from "../../core/daemon/agent-supervisor.js";
import type { RoomEnvelope } from "../../core/daemon/router.js";
import type { SessionEvent } from "../../core/daemon/session-events.js";

function makeAgent(id: string, userId: string, mode: AgentDefinition["respond"]["mode"]): AgentDefinition {
	return {
		id,
		name: id[0]?.toUpperCase() + id.slice(1),
		instructionsPath: `/tmp/${id}/AGENTS.md`,
		instructionsBody: `# ${id}\n\nRole for ${id}.`,
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

class FakeSession {
	public alive = true;
	public sentMessages: string[] = [];
	public readonly spawn = vi.fn(async () => undefined);
	public readonly dispose = vi.fn(() => {
		this.alive = false;
	});

	constructor(
		public readonly opts: {
			agent: AgentDefinition;
			onAgentEnd: (agentId: string, text: string) => void;
			onEvent: (agentId: string, event: SessionEvent) => void;
			onExit: (agentId: string, code: number | null) => void;
		},
	) {}

	async sendMessage(text: string): Promise<void> {
		this.sentMessages.push(text);
	}

	triggerAgentEnd(text: string): void {
		this.opts.onAgentEnd(this.opts.agent.id, text);
	}

	triggerEvent(event: SessionEvent): void {
		this.opts.onEvent(this.opts.agent.id, event);
	}

	triggerExit(code: number | null): void {
		this.alive = false;
		this.opts.onExit(this.opts.agent.id, code);
	}
}

async function flushAsyncWork(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("AgentSupervisor", () => {
	it("routes host-default messages to the host session and sends the preamble only once", async () => {
		const host = makeAgent("host", "@pi:bloom", "host");
		const planner = makeAgent("planner", "@planner:bloom", "mentioned");
		const createdSessions: FakeSession[] = [];
		const matrixPool = {
			getRoomAlias: vi.fn().mockResolvedValue("#general:bloom"),
			sendText: vi.fn().mockResolvedValue(undefined),
			setTyping: vi.fn().mockResolvedValue(undefined),
			stop: vi.fn(),
		};
		const supervisor = new AgentSupervisor({
			agents: [host, planner],
			matrixPool,
			sessionBaseDir: "/tmp/sessions",
			idleTimeoutMs: 60_000,
			createSession: (opts) => {
				const session = new FakeSession(opts);
				createdSessions.push(session);
				return session;
			},
		});

		await supervisor.handleEnvelope({
			roomId: "!room:bloom",
			eventId: "$evt1",
			senderUserId: "@alex:bloom",
			body: "hello there",
			senderKind: "human",
			mentions: [],
			timestamp: 1_000,
		});
		await supervisor.handleEnvelope({
			roomId: "!room:bloom",
			eventId: "$evt2",
			senderUserId: "@alex:bloom",
			body: "hello again",
			senderKind: "human",
			mentions: [],
			timestamp: 5_000,
		});

		expect(createdSessions).toHaveLength(1);
		expect(createdSessions[0]?.opts.agent.id).toBe("host");
		expect(createdSessions[0]?.sentMessages[0]).toContain('You are the Bloom agent "Host".');
		expect(createdSessions[0]?.sentMessages[0]).toContain("# host");
		expect(createdSessions[0]?.sentMessages[0]).toContain("[matrix: @alex:bloom] hello there");
		expect(createdSessions[0]?.sentMessages[1]).toBe("[matrix: @alex:bloom] hello again");
		expect(matrixPool.getRoomAlias).toHaveBeenCalledWith("host", "!room:bloom");

		await supervisor.shutdown();
	});

	it("routes explicit mentions to the mentioned agent, starts typing immediately, and sends replies from the correct Matrix identity", async () => {
		const host = makeAgent("host", "@pi:bloom", "host");
		const planner = makeAgent("planner", "@planner:bloom", "mentioned");
		const createdSessions: FakeSession[] = [];
		const matrixPool = {
			getRoomAlias: vi.fn().mockResolvedValue("#general:bloom"),
			sendText: vi.fn().mockResolvedValue(undefined),
			setTyping: vi.fn().mockResolvedValue(undefined),
			stop: vi.fn(),
		};
		const supervisor = new AgentSupervisor({
			agents: [host, planner],
			matrixPool,
			sessionBaseDir: "/tmp/sessions",
			idleTimeoutMs: 60_000,
			createSession: (opts) => {
				const session = new FakeSession(opts);
				createdSessions.push(session);
				return session;
			},
		});

		await supervisor.handleEnvelope({
			roomId: "!room:bloom",
			eventId: "$evt3",
			senderUserId: "@alex:bloom",
			body: "@planner:bloom help me plan",
			senderKind: "human",
			mentions: ["@planner:bloom"],
			timestamp: 1_000,
		});

		expect(createdSessions).toHaveLength(1);
		expect(createdSessions[0]?.opts.agent.id).toBe("planner");
		expect(matrixPool.setTyping).toHaveBeenCalledWith("planner", "!room:bloom", true, 30_000);
		createdSessions[0]?.triggerAgentEnd("Here is the plan.");
		await flushAsyncWork();
		expect(matrixPool.sendText).toHaveBeenCalledWith("planner", "!room:bloom", "Here is the plan.");

		await supervisor.shutdown();
	});

	it("sequences multi-agent mentions in mention order and hands prior output to the next agent", async () => {
		const critic = makeAgent("critic", "@critic:bloom", "mentioned");
		const planner = makeAgent("planner", "@planner:bloom", "mentioned");
		const createdSessions: FakeSession[] = [];
		const matrixPool = {
			getRoomAlias: vi.fn().mockResolvedValue("#general:bloom"),
			sendText: vi.fn().mockResolvedValue(undefined),
			setTyping: vi.fn().mockResolvedValue(undefined),
			stop: vi.fn(),
		};
		const supervisor = new AgentSupervisor({
			agents: [critic, planner],
			matrixPool,
			sessionBaseDir: "/tmp/sessions",
			idleTimeoutMs: 60_000,
			createSession: (opts) => {
				const session = new FakeSession(opts);
				createdSessions.push(session);
				return session;
			},
		});

		await supervisor.handleEnvelope({
			roomId: "!room:bloom",
			eventId: "$evt4",
			senderUserId: "@alex:bloom",
			body: "@planner:bloom propose a plan, then @critic:bloom point out the biggest flaw",
			senderKind: "human",
			mentions: ["@planner:bloom", "@critic:bloom"],
			timestamp: 1_000,
		});

		expect(createdSessions).toHaveLength(1);
		expect(createdSessions[0]?.opts.agent.id).toBe("planner");
		expect(createdSessions[0]?.sentMessages[0]).toContain(
			"[matrix: @alex:bloom] @planner:bloom propose a plan, then @critic:bloom point out the biggest flaw",
		);

		createdSessions[0]?.triggerAgentEnd("1. Clear junk\n2. Sort essentials\n3. Reset the desk");
		await flushAsyncWork();

		expect(matrixPool.sendText).toHaveBeenCalledWith(
			"planner",
			"!room:bloom",
			"1. Clear junk\n2. Sort essentials\n3. Reset the desk",
		);
		expect(createdSessions).toHaveLength(2);
		expect(createdSessions[1]?.opts.agent.id).toBe("critic");
		expect(createdSessions[1]?.sentMessages[0]).toContain("[system] This is a sequential multi-agent handoff.");
		expect(createdSessions[1]?.sentMessages[0]).toContain("Planner (@planner:bloom) replied:");
		expect(createdSessions[1]?.sentMessages[0]).toContain("1. Clear junk");
		expect(createdSessions[1]?.sentMessages[0]).toContain("Now respond as Critic (@critic:bloom).");

		await supervisor.shutdown();
	});

	it("maintains separate sessions per agent in the same room and toggles typing per agent", async () => {
		const host = makeAgent("host", "@pi:bloom", "host");
		const planner = makeAgent("planner", "@planner:bloom", "mentioned");
		const createdSessions: FakeSession[] = [];
		const matrixPool = {
			getRoomAlias: vi.fn().mockResolvedValue("#general:bloom"),
			sendText: vi.fn().mockResolvedValue(undefined),
			setTyping: vi.fn().mockResolvedValue(undefined),
			stop: vi.fn(),
		};
		const supervisor = new AgentSupervisor({
			agents: [host, planner],
			matrixPool,
			sessionBaseDir: "/tmp/sessions",
			idleTimeoutMs: 60_000,
			createSession: (opts) => {
				const session = new FakeSession(opts);
				createdSessions.push(session);
				return session;
			},
		});

		await supervisor.handleEnvelope({
			roomId: "!room:bloom",
			eventId: "$evt5",
			senderUserId: "@alex:bloom",
			body: "hello host",
			senderKind: "human",
			mentions: [],
			timestamp: 1_000,
		});
		await supervisor.handleEnvelope({
			roomId: "!room:bloom",
			eventId: "$evt6",
			senderUserId: "@alex:bloom",
			body: "@planner:bloom help",
			senderKind: "human",
			mentions: ["@planner:bloom"],
			timestamp: 5_000,
		});

		expect(createdSessions.map((session) => session.opts.agent.id)).toEqual(["host", "planner"]);

		createdSessions[1]?.triggerEvent({ type: "agent_start" });
		createdSessions[1]?.triggerEvent({ type: "agent_end" });
		expect(matrixPool.setTyping).toHaveBeenCalledWith("planner", "!room:bloom", true, 30_000);
		expect(matrixPool.setTyping).toHaveBeenCalledWith("planner", "!room:bloom", false, 30_000);

		await supervisor.shutdown();
	});

	it("recreates a dead session when the same target agent is needed again", async () => {
		const host = makeAgent("host", "@pi:bloom", "host");
		const createdSessions: FakeSession[] = [];
		const matrixPool = {
			getRoomAlias: vi.fn().mockResolvedValue("#general:bloom"),
			sendText: vi.fn().mockResolvedValue(undefined),
			setTyping: vi.fn().mockResolvedValue(undefined),
			stop: vi.fn(),
		};
		const supervisor = new AgentSupervisor({
			agents: [host],
			matrixPool,
			sessionBaseDir: "/tmp/sessions",
			idleTimeoutMs: 60_000,
			createSession: (opts) => {
				const session = new FakeSession(opts);
				createdSessions.push(session);
				return session;
			},
		});

		const firstEnvelope: RoomEnvelope = {
			roomId: "!room:bloom",
			eventId: "$evt7",
			senderUserId: "@alex:bloom",
			body: "hello",
			senderKind: "human",
			mentions: [],
			timestamp: 1_000,
		};
		await supervisor.handleEnvelope(firstEnvelope);
		createdSessions[0]?.triggerExit(1);
		await supervisor.handleEnvelope({ ...firstEnvelope, eventId: "$evt8", timestamp: 5_000 });

		expect(createdSessions).toHaveLength(2);

		await supervisor.shutdown();
	});
});
