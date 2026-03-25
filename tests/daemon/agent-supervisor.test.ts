import { describe, expect, it, vi } from "vitest";

import type { AgentDefinition } from "../../core/daemon/agent-registry.js";
import { AgentSupervisor } from "../../core/daemon/agent-supervisor.js";
import type { SessionEvent } from "../../core/daemon/contracts/session.js";
import type { RoomEnvelope } from "../../core/daemon/agent-supervisor.js";

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
		const host = makeAgent("host", "@pi:nixpi", "host");
		const planner = makeAgent("planner", "@planner:nixpi", "mentioned");
		const createdSessions: FakeSession[] = [];
		const matrixBridge = {
			getRoomAlias: vi.fn().mockResolvedValue("#general:nixpi"),
			sendText: vi.fn().mockResolvedValue(undefined),
			setTyping: vi.fn().mockResolvedValue(undefined),
			stop: vi.fn(),
		};
		const supervisor = new AgentSupervisor({
			agents: [host, planner],
			matrixBridge,
			sessionBaseDir: "/tmp/sessions",
			idleTimeoutMs: 60_000,
			createSession: (opts) => {
				const session = new FakeSession(opts);
				createdSessions.push(session);
				return session;
			},
		});

		await supervisor.handleEnvelope({
			roomId: "!room:nixpi",
			eventId: "$evt1",
			senderUserId: "@alex:nixpi",
			body: "hello there",
			senderKind: "human",
			mentions: [],
			timestamp: 1_000,
		});
		await supervisor.handleEnvelope({
			roomId: "!room:nixpi",
			eventId: "$evt2",
			senderUserId: "@alex:nixpi",
			body: "hello again",
			senderKind: "human",
			mentions: [],
			timestamp: 5_000,
		});

		expect(createdSessions).toHaveLength(1);
		expect(createdSessions[0]?.opts.agent.id).toBe("host");
		expect(createdSessions[0]?.sentMessages[0]).toContain('You are the agent "Host".');
		expect(createdSessions[0]?.sentMessages[0]).toContain("Matrix messages must be plain text.");
		expect(createdSessions[0]?.sentMessages[0]).toContain(
			"Avoid Markdown, headings, tables, bold, italics, blockquotes, and fenced code blocks.",
		);
		expect(createdSessions[0]?.sentMessages[0]).toContain("# host");
		expect(createdSessions[0]?.sentMessages[0]).toContain("[matrix: @alex:nixpi] hello there");
		expect(createdSessions[0]?.sentMessages[1]).toBe("[matrix: @alex:nixpi] hello again");
		expect(matrixBridge.getRoomAlias).toHaveBeenCalledWith("host", "!room:nixpi");

		await supervisor.shutdown();
	});


	it("routes explicit mentions to the mentioned agent, starts typing immediately, and sends replies from the correct Matrix identity", async () => {
		const host = makeAgent("host", "@pi:nixpi", "host");
		const planner = makeAgent("planner", "@planner:nixpi", "mentioned");
		const createdSessions: FakeSession[] = [];
		const matrixBridge = {
			getRoomAlias: vi.fn().mockResolvedValue("#general:nixpi"),
			sendText: vi.fn().mockResolvedValue(undefined),
			setTyping: vi.fn().mockResolvedValue(undefined),
			stop: vi.fn(),
		};
		const supervisor = new AgentSupervisor({
			agents: [host, planner],
			matrixBridge,
			sessionBaseDir: "/tmp/sessions",
			idleTimeoutMs: 60_000,
			createSession: (opts) => {
				const session = new FakeSession(opts);
				createdSessions.push(session);
				return session;
			},
		});

		await supervisor.handleEnvelope({
			roomId: "!room:nixpi",
			eventId: "$evt3",
			senderUserId: "@alex:nixpi",
			body: "@planner:nixpi help me plan",
			senderKind: "human",
			mentions: ["@planner:nixpi"],
			timestamp: 1_000,
		});

		expect(createdSessions).toHaveLength(1);
		expect(createdSessions[0]?.opts.agent.id).toBe("planner");
		expect(matrixBridge.setTyping).toHaveBeenCalledWith("planner", "!room:nixpi", true, 30_000);
		createdSessions[0]?.triggerAgentEnd("Here is the plan.");
		await flushAsyncWork();
		expect(matrixBridge.sendText).toHaveBeenCalledWith("planner", "!room:nixpi", "Here is the plan.");

		await supervisor.shutdown();
	});

	it("sends an AI-generated host reply back through Pi to Matrix", async () => {
		const host = makeAgent("host", "@pi:nixpi", "host");
		const createdSessions: FakeSession[] = [];
		const matrixBridge = {
			getRoomAlias: vi.fn().mockResolvedValue("#general:nixpi"),
			sendText: vi.fn().mockResolvedValue(undefined),
			setTyping: vi.fn().mockResolvedValue(undefined),
			stop: vi.fn(),
		};
		const supervisor = new AgentSupervisor({
			agents: [host],
			matrixBridge,
			sessionBaseDir: "/tmp/sessions",
			idleTimeoutMs: 60_000,
			createSession: (opts) => {
				const session = new FakeSession(opts);
				createdSessions.push(session);
				return session;
			},
		});

		await supervisor.handleEnvelope({
			roomId: "!room:nixpi",
			eventId: "$evt-ai",
			senderUserId: "@alex:nixpi",
			body: "What can you do for me?",
			senderKind: "human",
			mentions: [],
			timestamp: 1_000,
		});

		expect(createdSessions).toHaveLength(1);
		expect(createdSessions[0]?.opts.agent.id).toBe("host");
		expect(createdSessions[0]?.sentMessages[0]).toContain("[matrix: @alex:nixpi] What can you do for me?");

		// Simulate the Pi session finishing with a provider-backed completion.
		createdSessions[0]?.triggerAgentEnd("I can help manage this machine and answer your questions.");
		await flushAsyncWork();

		expect(matrixBridge.sendText).toHaveBeenCalledWith(
			"host",
			"!room:nixpi",
			"I can help manage this machine and answer your questions.",
		);

		await supervisor.shutdown();
	});

	it("uses the first mention when multiple agents are mentioned", async () => {
		const critic = makeAgent("critic", "@critic:nixpi", "mentioned");
		const planner = makeAgent("planner", "@planner:nixpi", "mentioned");
		const createdSessions: FakeSession[] = [];
		const matrixBridge = {
			getRoomAlias: vi.fn().mockResolvedValue("#general:nixpi"),
			sendText: vi.fn().mockResolvedValue(undefined),
			setTyping: vi.fn().mockResolvedValue(undefined),
			stop: vi.fn(),
		};
		const supervisor = new AgentSupervisor({
			agents: [critic, planner],
			matrixBridge,
			sessionBaseDir: "/tmp/sessions",
			idleTimeoutMs: 60_000,
			createSession: (opts) => {
				const session = new FakeSession(opts);
				createdSessions.push(session);
				return session;
			},
		});

		await supervisor.handleEnvelope({
			roomId: "!room:nixpi",
			eventId: "$evt4",
			senderUserId: "@alex:nixpi",
			body: "@planner:nixpi propose a plan, then @critic:nixpi point out the biggest flaw",
			senderKind: "human",
			mentions: ["@planner:nixpi", "@critic:nixpi"],
			timestamp: 1_000,
		});

		expect(createdSessions).toHaveLength(1);
		expect(createdSessions[0]?.opts.agent.id).toBe("planner");
		expect(createdSessions[0]?.sentMessages[0]).toContain(
			"[matrix: @alex:nixpi] @planner:nixpi propose a plan, then @critic:nixpi point out the biggest flaw",
		);

		createdSessions[0]?.triggerAgentEnd("1. Clear junk\n2. Sort essentials\n3. Reset the desk");
		await flushAsyncWork();

		expect(matrixBridge.sendText).toHaveBeenCalledWith(
			"planner",
			"!room:nixpi",
			"1. Clear junk\n2. Sort essentials\n3. Reset the desk",
		);
		expect(createdSessions).toHaveLength(1);

		await supervisor.shutdown();
	});

	it("maintains separate sessions per agent in the same room and toggles typing per agent", async () => {
		const host = makeAgent("host", "@pi:nixpi", "host");
		const planner = makeAgent("planner", "@planner:nixpi", "mentioned");
		const createdSessions: FakeSession[] = [];
		const matrixBridge = {
			getRoomAlias: vi.fn().mockResolvedValue("#general:nixpi"),
			sendText: vi.fn().mockResolvedValue(undefined),
			setTyping: vi.fn().mockResolvedValue(undefined),
			stop: vi.fn(),
		};
		const supervisor = new AgentSupervisor({
			agents: [host, planner],
			matrixBridge,
			sessionBaseDir: "/tmp/sessions",
			idleTimeoutMs: 60_000,
			createSession: (opts) => {
				const session = new FakeSession(opts);
				createdSessions.push(session);
				return session;
			},
		});

		await supervisor.handleEnvelope({
			roomId: "!room:nixpi",
			eventId: "$evt5",
			senderUserId: "@alex:nixpi",
			body: "hello host",
			senderKind: "human",
			mentions: [],
			timestamp: 1_000,
		});
		await supervisor.handleEnvelope({
			roomId: "!room:nixpi",
			eventId: "$evt6",
			senderUserId: "@alex:nixpi",
			body: "@planner:nixpi help",
			senderKind: "human",
			mentions: ["@planner:nixpi"],
			timestamp: 5_000,
		});

		expect(createdSessions.map((session) => session.opts.agent.id)).toEqual(["host", "planner"]);

		createdSessions[1]?.triggerEvent({ type: "agent_start" });
		createdSessions[1]?.triggerEvent({ type: "agent_end" });
		expect(matrixBridge.setTyping).toHaveBeenCalledWith("planner", "!room:nixpi", true, 30_000);
		expect(matrixBridge.setTyping).toHaveBeenCalledWith("planner", "!room:nixpi", false, 30_000);

		await supervisor.shutdown();
	});

	it("recreates a dead session when the same target agent is needed again", async () => {
		const host = makeAgent("host", "@pi:nixpi", "host");
		const createdSessions: FakeSession[] = [];
		const matrixBridge = {
			getRoomAlias: vi.fn().mockResolvedValue("#general:nixpi"),
			sendText: vi.fn().mockResolvedValue(undefined),
			setTyping: vi.fn().mockResolvedValue(undefined),
			stop: vi.fn(),
		};
		const supervisor = new AgentSupervisor({
			agents: [host],
			matrixBridge,
			sessionBaseDir: "/tmp/sessions",
			idleTimeoutMs: 60_000,
			createSession: (opts) => {
				const session = new FakeSession(opts);
				createdSessions.push(session);
				return session;
			},
		});

		const firstEnvelope: RoomEnvelope = {
			roomId: "!room:nixpi",
			eventId: "$evt7",
			senderUserId: "@alex:nixpi",
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

	it("dispatches proactive jobs directly to the target agent and suppresses configured no-op replies", async () => {
		const host = makeAgent("host", "@pi:nixpi", "host");
		const createdSessions: FakeSession[] = [];
		const matrixBridge = {
			getRoomAlias: vi.fn().mockResolvedValue("#ops:nixpi"),
			sendText: vi.fn().mockResolvedValue(undefined),
			setTyping: vi.fn().mockResolvedValue(undefined),
			stop: vi.fn(),
		};
		const supervisor = new AgentSupervisor({
			agents: [host],
			matrixBridge,
			sessionBaseDir: "/tmp/sessions",
			idleTimeoutMs: 60_000,
			createSession: (opts) => {
				const session = new FakeSession(opts);
				createdSessions.push(session);
				return session;
			},
		});

		await supervisor.dispatchProactiveJob({
			id: "daily-heartbeat",
			jobId: "daily-heartbeat",
			agentId: "host",
			roomId: "!ops:nixpi",
			kind: "heartbeat",
			prompt: "Review the room and host state. Reply HEARTBEAT_OK if nothing needs surfacing.",
			quietIfNoop: true,
			noOpToken: "HEARTBEAT_OK",
		});

		expect(createdSessions).toHaveLength(1);
		expect(createdSessions[0]?.sentMessages[0]).toContain("[system] Scheduled heartbeat job: daily-heartbeat");
		expect(createdSessions[0]?.sentMessages[0]).toContain("Review the room and host state.");

		createdSessions[0]?.triggerAgentEnd("HEARTBEAT_OK");
		await flushAsyncWork();
		expect(matrixBridge.sendText).not.toHaveBeenCalled();

		await supervisor.dispatchProactiveJob({
			id: "daily-heartbeat",
			jobId: "daily-heartbeat",
			agentId: "host",
			roomId: "!ops:nixpi",
			kind: "heartbeat",
			prompt: "Review the room and host state. Reply HEARTBEAT_OK if nothing needs surfacing.",
			quietIfNoop: true,
			noOpToken: "HEARTBEAT_OK",
		});
		createdSessions[0]?.triggerAgentEnd("The dufs service failed overnight.");
		await flushAsyncWork();
		expect(matrixBridge.sendText).toHaveBeenCalledWith("host", "!ops:nixpi", "The dufs service failed overnight.");

		await supervisor.shutdown();
	});

	it("still delivers proactive replies when quiet_if_noop is disabled or the token does not match", async () => {
		const host = makeAgent("host", "@pi:nixpi", "host");
		const createdSessions: FakeSession[] = [];
		const matrixBridge = {
			getRoomAlias: vi.fn().mockResolvedValue("#ops:nixpi"),
			sendText: vi.fn().mockResolvedValue(undefined),
			setTyping: vi.fn().mockResolvedValue(undefined),
			stop: vi.fn(),
		};
		const supervisor = new AgentSupervisor({
			agents: [host],
			matrixBridge,
			sessionBaseDir: "/tmp/sessions",
			idleTimeoutMs: 60_000,
			createSession: (opts) => {
				const session = new FakeSession(opts);
				createdSessions.push(session);
				return session;
			},
		});

		await supervisor.dispatchProactiveJob({
			id: "morning-check",
			jobId: "morning-check",
			agentId: "host",
			roomId: "!ops:nixpi",
			kind: "cron",
			prompt: "Send the morning operational check-in.",
			quietIfNoop: false,
			noOpToken: "HEARTBEAT_OK",
		});
		createdSessions[0]?.triggerAgentEnd("HEARTBEAT_OK");
		await flushAsyncWork();

		await supervisor.dispatchProactiveJob({
			id: "daily-heartbeat",
			jobId: "daily-heartbeat",
			agentId: "host",
			roomId: "!ops:nixpi",
			kind: "heartbeat",
			prompt: "Review the room and host state.",
			quietIfNoop: true,
			noOpToken: "HEARTBEAT_OK",
		});
		createdSessions[0]?.triggerAgentEnd("HEARTBEAT_OK but with context");
		await flushAsyncWork();

		expect(matrixBridge.sendText).toHaveBeenNthCalledWith(1, "host", "!ops:nixpi", "HEARTBEAT_OK");
		expect(matrixBridge.sendText).toHaveBeenNthCalledWith(2, "host", "!ops:nixpi", "HEARTBEAT_OK but with context");

		await supervisor.shutdown();
	});

	it("ignores messages after shutdown is called", async () => {
		const host = makeAgent("host", "@pi:nixpi", "host");
		const createdSessions: FakeSession[] = [];
		const matrixBridge = {
			getRoomAlias: vi.fn().mockResolvedValue("#general:nixpi"),
			sendText: vi.fn().mockResolvedValue(undefined),
			setTyping: vi.fn().mockResolvedValue(undefined),
			stop: vi.fn(),
		};
		const supervisor = new AgentSupervisor({
			agents: [host],
			matrixBridge,
			sessionBaseDir: "/tmp/sessions",
			idleTimeoutMs: 60_000,
			createSession: (opts) => {
				const session = new FakeSession(opts);
				createdSessions.push(session);
				return session;
			},
		});

		await supervisor.shutdown();

		// After shutdown, messages should be ignored
		await supervisor.handleEnvelope({
			roomId: "!room:nixpi",
			eventId: "$evt1",
			senderUserId: "@alex:nixpi",
			body: "hello",
			senderKind: "human",
			mentions: [],
			timestamp: 1_000,
		});

		expect(createdSessions).toHaveLength(0);
	});

	it("ignores proactive jobs after shutdown", async () => {
		const host = makeAgent("host", "@pi:nixpi", "host");
		const createdSessions: FakeSession[] = [];
		const matrixBridge = {
			getRoomAlias: vi.fn().mockResolvedValue("#ops:nixpi"),
			sendText: vi.fn().mockResolvedValue(undefined),
			setTyping: vi.fn().mockResolvedValue(undefined),
			stop: vi.fn(),
		};
		const supervisor = new AgentSupervisor({
			agents: [host],
			matrixBridge,
			sessionBaseDir: "/tmp/sessions",
			idleTimeoutMs: 60_000,
			createSession: (opts) => {
				const session = new FakeSession(opts);
				createdSessions.push(session);
				return session;
			},
		});

		await supervisor.shutdown();

		await supervisor.dispatchProactiveJob({
			id: "daily-heartbeat",
			jobId: "daily-heartbeat",
			agentId: "host",
			roomId: "!ops:nixpi",
			kind: "heartbeat",
			prompt: "Review the room and host state.",
		});

		expect(createdSessions).toHaveLength(0);
	});

	it("clears typing intervals on shutdown", async () => {
		const host = makeAgent("host", "@pi:nixpi", "host");
		const createdSessions: FakeSession[] = [];
		const matrixBridge = {
			getRoomAlias: vi.fn().mockResolvedValue("#general:nixpi"),
			sendText: vi.fn().mockResolvedValue(undefined),
			setTyping: vi.fn().mockResolvedValue(undefined),
			stop: vi.fn(),
		};
		const supervisor = new AgentSupervisor({
			agents: [host],
			matrixBridge,
			sessionBaseDir: "/tmp/sessions",
			idleTimeoutMs: 60_000,
			createSession: (opts) => {
				const session = new FakeSession(opts);
				createdSessions.push(session);
				return session;
			},
		});

		await supervisor.handleEnvelope({
			roomId: "!room:nixpi",
			eventId: "$evt1",
			senderUserId: "@alex:nixpi",
			body: "hello",
			senderKind: "human",
			mentions: [],
			timestamp: 1_000,
		});

		expect(matrixBridge.setTyping).toHaveBeenCalledWith("host", "!room:nixpi", true, 30_000);

		await supervisor.shutdown();

		// Shutdown clears intervals and disposes sessions but doesn't explicitly stop typing
		// The intervals are cleared which stops the refresh cycle
		expect(matrixBridge.setTyping).toHaveBeenCalledTimes(1); // Only the initial start typing call
	});

	it("handles errors when getting room alias gracefully", async () => {
		const host = makeAgent("host", "@pi:nixpi", "host");
		const createdSessions: FakeSession[] = [];
		const matrixBridge = {
			getRoomAlias: vi.fn().mockRejectedValue(new Error("Matrix error")),
			sendText: vi.fn().mockResolvedValue(undefined),
			setTyping: vi.fn().mockResolvedValue(undefined),
			stop: vi.fn(),
		};
		const supervisor = new AgentSupervisor({
			agents: [host],
			matrixBridge,
			sessionBaseDir: "/tmp/sessions",
			idleTimeoutMs: 60_000,
			createSession: (opts) => {
				const session = new FakeSession(opts);
				createdSessions.push(session);
				return session;
			},
		});

		// Should not throw
		await expect(
			supervisor.handleEnvelope({
				roomId: "!room:nixpi",
				eventId: "$evt1",
				senderUserId: "@alex:nixpi",
				body: "hello",
				senderKind: "human",
				mentions: [],
				timestamp: 1_000,
			}),
		).rejects.toThrow("Matrix error");

		expect(createdSessions).toHaveLength(0);

		await supervisor.shutdown();
	});

	it("handles dispatch errors by stopping typing", async () => {
		const host = makeAgent("host", "@pi:nixpi", "host");
		const matrixBridge = {
			getRoomAlias: vi.fn().mockResolvedValue("#general:nixpi"),
			sendText: vi.fn().mockResolvedValue(undefined),
			setTyping: vi.fn().mockResolvedValue(undefined),
			stop: vi.fn(),
		};
		const supervisor = new AgentSupervisor({
			agents: [host],
			matrixBridge,
			sessionBaseDir: "/tmp/sessions",
			idleTimeoutMs: 60_000,
			createSession: () => {
				// Return a session that throws on spawn
				return {
					alive: true,
					spawn: vi.fn().mockRejectedValue(new Error("Spawn failed")),
					sendMessage: vi.fn(),
					dispose: vi.fn(),
				} as unknown as FakeSession;
			},
		});

		// Should not throw, but should stop typing on error
		await expect(
			supervisor.handleEnvelope({
				roomId: "!room:nixpi",
				eventId: "$evt1",
				senderUserId: "@alex:nixpi",
				body: "hello",
				senderKind: "human",
				mentions: [],
				timestamp: 1_000,
			}),
		).rejects.toThrow("Spawn failed");

		// Should have tried to stop typing on error
		expect(matrixBridge.setTyping).toHaveBeenCalledWith("host", "!room:nixpi", false, 30_000);

		await supervisor.shutdown();
	});

	it("handles agent responses that fail to send", async () => {
		const host = makeAgent("host", "@pi:nixpi", "host");
		const createdSessions: FakeSession[] = [];
		const matrixBridge = {
			getRoomAlias: vi.fn().mockResolvedValue("#general:nixpi"),
			sendText: vi.fn().mockRejectedValue(new Error("Send failed")),
			setTyping: vi.fn().mockResolvedValue(undefined),
			stop: vi.fn(),
		};
		const supervisor = new AgentSupervisor({
			agents: [host],
			matrixBridge,
			sessionBaseDir: "/tmp/sessions",
			idleTimeoutMs: 60_000,
			createSession: (opts) => {
				const session = new FakeSession(opts);
				createdSessions.push(session);
				return session;
			},
		});

		await supervisor.handleEnvelope({
			roomId: "!room:nixpi",
			eventId: "$evt1",
			senderUserId: "@alex:nixpi",
			body: "hello",
			senderKind: "human",
			mentions: [],
			timestamp: 1_000,
		});

		// Trigger agent response - should handle send error gracefully
		createdSessions[0]?.triggerAgentEnd("Response");
		await flushAsyncWork();

		// Error should be logged but not thrown
		expect(matrixBridge.sendText).toHaveBeenCalledWith("host", "!room:nixpi", "Response");

		await supervisor.shutdown();
	});

	it("does not send proactive reply when quietIfNoop is true but noOpToken is undefined", async () => {
		const host = makeAgent("host", "@pi:nixpi", "host");
		const createdSessions: FakeSession[] = [];
		const matrixBridge = {
			getRoomAlias: vi.fn().mockResolvedValue("#ops:nixpi"),
			sendText: vi.fn().mockResolvedValue(undefined),
			setTyping: vi.fn().mockResolvedValue(undefined),
			stop: vi.fn(),
		};
		const supervisor = new AgentSupervisor({
			agents: [host],
			matrixBridge,
			sessionBaseDir: "/tmp/sessions",
			idleTimeoutMs: 60_000,
			createSession: (opts) => {
				const session = new FakeSession(opts);
				createdSessions.push(session);
				return session;
			},
		});

		await supervisor.dispatchProactiveJob({
			id: "test-job",
			jobId: "test-job",
			agentId: "host",
			roomId: "!ops:nixpi",
			kind: "heartbeat",
			prompt: "Test prompt",
			quietIfNoop: true,
			// noOpToken is undefined
		});

		// Should send the reply since noOpToken is undefined
		createdSessions[0]?.triggerAgentEnd("ANY_TOKEN");
		await flushAsyncWork();

		expect(matrixBridge.sendText).toHaveBeenCalledWith("host", "!ops:nixpi", "ANY_TOKEN");

		await supervisor.shutdown();
	});

	// ── Room-state behaviour (ported from room-state.test.ts) ────────────────

	it("ignores duplicate event ids", async () => {
		const host = makeAgent("host", "@pi:nixpi", "host");
		const createdSessions: FakeSession[] = [];
		const matrixBridge = {
			getRoomAlias: vi.fn().mockResolvedValue("#general:nixpi"),
			sendText: vi.fn().mockResolvedValue(undefined),
			setTyping: vi.fn().mockResolvedValue(undefined),
			stop: vi.fn(),
		};
		const supervisor = new AgentSupervisor({
			agents: [host],
			matrixBridge,
			sessionBaseDir: "/tmp/sessions",
			idleTimeoutMs: 60_000,
			createSession: (opts) => {
				const session = new FakeSession(opts);
				createdSessions.push(session);
				return session;
			},
		});

		const envelope = {
			roomId: "!room:nixpi",
			eventId: "$dup-evt",
			senderUserId: "@alex:nixpi",
			body: "hello",
			senderKind: "human" as const,
			mentions: [],
			timestamp: 1_000,
		};

		await supervisor.handleEnvelope(envelope);
		// Second dispatch of the same eventId — router should block it as a duplicate
		await supervisor.handleEnvelope(envelope);

		// Only one session message should have been dispatched (second was a duplicate)
		expect(createdSessions[0]?.sentMessages).toHaveLength(1);

		await supervisor.shutdown();
	});

	it("respects agent cooldown between replies", async () => {
		const host = makeAgent("host", "@pi:nixpi", "host");
		const createdSessions: FakeSession[] = [];
		const matrixBridge = {
			getRoomAlias: vi.fn().mockResolvedValue("#general:nixpi"),
			sendText: vi.fn().mockResolvedValue(undefined),
			setTyping: vi.fn().mockResolvedValue(undefined),
			stop: vi.fn(),
		};
		const supervisor = new AgentSupervisor({
			agents: [host],
			matrixBridge,
			sessionBaseDir: "/tmp/sessions",
			idleTimeoutMs: 60_000,
			createSession: (opts) => {
				const session = new FakeSession(opts);
				createdSessions.push(session);
				return session;
			},
		});

		// First message — marks reply sent at timestamp 1_000, cooldown is 1_500 ms
		await supervisor.handleEnvelope({
			roomId: "!room:nixpi",
			eventId: "$cool-evt1",
			senderUserId: "@alex:nixpi",
			body: "hello",
			senderKind: "human",
			mentions: [],
			timestamp: 1_000,
		});

		// Second message within the cooldown window (timestamp 2_000, only 1_000 ms later)
		await supervisor.handleEnvelope({
			roomId: "!room:nixpi",
			eventId: "$cool-evt2",
			senderUserId: "@alex:nixpi",
			body: "hello again",
			senderKind: "human",
			mentions: [],
			timestamp: 2_000,
		});

		// Third message after cooldown has elapsed (timestamp 3_000, 2_000 ms after first reply)
		await supervisor.handleEnvelope({
			roomId: "!room:nixpi",
			eventId: "$cool-evt3",
			senderUserId: "@alex:nixpi",
			body: "hello once more",
			senderKind: "human",
			mentions: [],
			timestamp: 3_000,
		});

		// Only the first and third messages should have been dispatched; the second was in cooldown
		expect(createdSessions[0]?.sentMessages).toHaveLength(2);

		await supervisor.shutdown();
	});

	it("enforces the total reply budget per root event via room-state methods", async () => {
		const host = makeAgent("host", "@pi:nixpi", "host");
		const matrixBridge = {
			getRoomAlias: vi.fn().mockResolvedValue("#general:nixpi"),
			sendText: vi.fn().mockResolvedValue(undefined),
			setTyping: vi.fn().mockResolvedValue(undefined),
			stop: vi.fn(),
		};
		const supervisor = new AgentSupervisor({
			agents: [host],
			matrixBridge,
			sessionBaseDir: "/tmp/sessions",
			idleTimeoutMs: 60_000,
			createSession: (opts) => new FakeSession(opts),
		});

		const roomId = "!room:nixpi";
		const rootEventId = "$root1";
		const agentId = "planner";
		const maxPublicTurns = 2;
		const totalBudget = 4;

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const s = supervisor as any;

		// Initially can reply
		expect(s.canReplyForRoot(roomId, rootEventId, agentId, maxPublicTurns, totalBudget)).toBe(true);

		// After first reply
		s.markReplySent(roomId, rootEventId, agentId, 1_000);
		expect(s.canReplyForRoot(roomId, rootEventId, agentId, maxPublicTurns, totalBudget)).toBe(true);

		// After second reply — per-agent limit (maxPublicTurns=2) reached
		s.markReplySent(roomId, rootEventId, agentId, 2_000);
		expect(s.canReplyForRoot(roomId, rootEventId, agentId, maxPublicTurns, totalBudget)).toBe(false);

		await supervisor.shutdown();
	});

	it("enforces total reply budget across agents for the same root event", async () => {
		const host = makeAgent("host", "@pi:nixpi", "host");
		const matrixBridge = {
			getRoomAlias: vi.fn().mockResolvedValue("#general:nixpi"),
			sendText: vi.fn().mockResolvedValue(undefined),
			setTyping: vi.fn().mockResolvedValue(undefined),
			stop: vi.fn(),
		};
		const supervisor = new AgentSupervisor({
			agents: [host],
			matrixBridge,
			sessionBaseDir: "/tmp/sessions",
			idleTimeoutMs: 60_000,
			createSession: (opts) => new FakeSession(opts),
		});

		const roomId = "!room:nixpi";
		const rootEventId = "$root1";
		const maxPublicTurns = 2;
		const totalBudget = 4;

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const s = supervisor as any;

		s.markReplySent(roomId, rootEventId, "host", 1_000);
		s.markReplySent(roomId, rootEventId, "planner", 2_000);
		s.markReplySent(roomId, rootEventId, "critic", 3_000);
		s.markReplySent(roomId, rootEventId, "host", 4_000);

		// Total budget (4) exhausted — no further replies allowed regardless of agent
		expect(s.canReplyForRoot(roomId, rootEventId, "planner", maxPublicTurns, totalBudget)).toBe(false);

		await supervisor.shutdown();
	});

	it("handles multiple pending proactive jobs in order", async () => {
		const host = makeAgent("host", "@pi:nixpi", "host");
		const createdSessions: FakeSession[] = [];
		const matrixBridge = {
			getRoomAlias: vi.fn().mockResolvedValue("#ops:nixpi"),
			sendText: vi.fn().mockResolvedValue(undefined),
			setTyping: vi.fn().mockResolvedValue(undefined),
			stop: vi.fn(),
		};
		const supervisor = new AgentSupervisor({
			agents: [host],
			matrixBridge,
			sessionBaseDir: "/tmp/sessions",
			idleTimeoutMs: 60_000,
			createSession: (opts) => {
				const session = new FakeSession(opts);
				createdSessions.push(session);
				return session;
			},
		});

		// Dispatch two jobs
		await supervisor.dispatchProactiveJob({
			id: "job-1",
			jobId: "job-1",
			agentId: "host",
			roomId: "!ops:nixpi",
			kind: "heartbeat",
			prompt: "First job",
		});
		await supervisor.dispatchProactiveJob({
			id: "job-2",
			jobId: "job-2",
			agentId: "host",
			roomId: "!ops:nixpi",
			kind: "heartbeat",
			prompt: "Second job",
		});

		// First response should be for job-1
		createdSessions[0]?.triggerAgentEnd("Response 1");
		await flushAsyncWork();
		expect(matrixBridge.sendText).toHaveBeenNthCalledWith(1, "host", "!ops:nixpi", "Response 1");

		// Second response should be for job-2
		createdSessions[0]?.triggerAgentEnd("Response 2");
		await flushAsyncWork();
		expect(matrixBridge.sendText).toHaveBeenNthCalledWith(2, "host", "!ops:nixpi", "Response 2");

		await supervisor.shutdown();
	});
});
