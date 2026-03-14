import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentDefinition } from "../../core/daemon/agent-registry.js";

const createdSessions: Array<{
	opts: Record<string, unknown>;
	alive: boolean;
	sendMessage: ReturnType<typeof vi.fn>;
	spawn: ReturnType<typeof vi.fn>;
	dispose: ReturnType<typeof vi.fn>;
}> = [];

vi.mock("../../core/daemon/pi-room-session.js", () => ({
	PiRoomSession: class {
		public alive = true;
		public readonly opts: Record<string, unknown>;
		public readonly sendMessage = vi.fn(async (_text: string) => undefined);
		public readonly spawn = vi.fn(async () => undefined);
		public readonly dispose = vi.fn(() => {
			this.alive = false;
		});

		constructor(opts: Record<string, unknown>) {
			this.opts = opts;
			createdSessions.push(this);
		}
	},
}));

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

describe("AgentSession", () => {
	let tmpDir: string;
	let sessionBaseDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "agent-session-"));
		sessionBaseDir = join(tmpDir, "sessions");
		mkdirSync(sessionBaseDir, { recursive: true });
		createdSessions.length = 0;
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("creates separate session directories for the same room with different agents", async () => {
		const { AgentSession } = await import("../../core/daemon/agent-session.js");
		const host = makeAgent("host", "@pi:bloom", "host");
		const planner = makeAgent("planner", "@planner:bloom", "mentioned");

		const hostSession = new AgentSession({
			roomId: "!abc:bloom",
			roomAlias: "#general:bloom",
			agent: host,
			sessionBaseDir,
			idleTimeoutMs: 60_000,
			onAgentEnd: vi.fn(),
			onEvent: vi.fn(),
			onExit: vi.fn(),
		});
		const plannerSession = new AgentSession({
			roomId: "!abc:bloom",
			roomAlias: "#general:bloom",
			agent: planner,
			sessionBaseDir,
			idleTimeoutMs: 60_000,
			onAgentEnd: vi.fn(),
			onEvent: vi.fn(),
			onExit: vi.fn(),
		});

		await hostSession.spawn();
		await plannerSession.spawn();

		expect(hostSession.agentId).toBe("host");
		expect(plannerSession.agentId).toBe("planner");
		expect(hostSession.sessionDir).toBe(join(sessionBaseDir, "general_bloom", "host"));
		expect(plannerSession.sessionDir).toBe(join(sessionBaseDir, "general_bloom", "planner"));
		expect(createdSessions[0]?.opts).toMatchObject({
			sanitizedAlias: "general_bloom-host",
			sessionDir: join(sessionBaseDir, "general_bloom", "host"),
		});
		expect(createdSessions[1]?.opts).toMatchObject({
			sanitizedAlias: "general_bloom-planner",
			sessionDir: join(sessionBaseDir, "general_bloom", "planner"),
		});
	});

	it("forwards sendMessage and dispose to the wrapped Pi room session", async () => {
		const { AgentSession } = await import("../../core/daemon/agent-session.js");
		const planner = makeAgent("planner", "@planner:bloom", "mentioned");
		const session = new AgentSession({
			roomId: "!abc:bloom",
			roomAlias: "#general:bloom",
			agent: planner,
			sessionBaseDir,
			idleTimeoutMs: 60_000,
			onAgentEnd: vi.fn(),
			onEvent: vi.fn(),
			onExit: vi.fn(),
		});

		await session.spawn();
		await session.sendMessage("hello");
		session.dispose();

		expect(createdSessions[0]?.sendMessage).toHaveBeenCalledWith("hello");
		expect(createdSessions[0]?.dispose).toHaveBeenCalled();
		expect(session.alive).toBe(false);
	});

	it("wraps callbacks with the agent id", async () => {
		const { AgentSession } = await import("../../core/daemon/agent-session.js");
		const planner = makeAgent("planner", "@planner:bloom", "mentioned");
		const onAgentEnd = vi.fn();
		const onEvent = vi.fn();
		const onExit = vi.fn();
		const session = new AgentSession({
			roomId: "!abc:bloom",
			roomAlias: "#general:bloom",
			agent: planner,
			sessionBaseDir,
			idleTimeoutMs: 60_000,
			onAgentEnd,
			onEvent,
			onExit,
		});

		await session.spawn();

		const opts = createdSessions[0]?.opts as {
			onAgentEnd: (text: string) => void;
			onEvent: (event: { type: string }) => void;
			onExit: (code: number | null) => void;
		};
		opts.onAgentEnd("done");
		opts.onEvent({ type: "agent_end" });
		opts.onExit(1);

		expect(onAgentEnd).toHaveBeenCalledWith("planner", "done");
		expect(onEvent).toHaveBeenCalledWith("planner", { type: "agent_end" });
		expect(onExit).toHaveBeenCalledWith("planner", 1);
	});
});
