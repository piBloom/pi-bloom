import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentDefinition } from "../../core/daemon/agent-registry.js";

interface MockClientInstance {
	homeserver: string;
	accessToken: string;
	handlers: Map<string, (roomId: string, event: Record<string, unknown>) => void>;
	sendText: ReturnType<typeof vi.fn>;
	setTyping: ReturnType<typeof vi.fn>;
	start: ReturnType<typeof vi.fn>;
	stop: ReturnType<typeof vi.fn>;
	getPublishedAlias: ReturnType<typeof vi.fn>;
}

const { mockInstances, mockSetupOnClient } = vi.hoisted(() => ({
	mockInstances: [] as MockClientInstance[],
	mockSetupOnClient: vi.fn(),
}));

vi.mock("matrix-bot-sdk", () => ({
	MatrixClient: class {
		public homeserver: string;
		public accessToken: string;
		public handlers = new Map<string, (roomId: string, event: Record<string, unknown>) => void>();
		public sendText = vi.fn().mockResolvedValue(undefined);
		public setTyping = vi.fn().mockResolvedValue(undefined);
		public start = vi.fn().mockResolvedValue(undefined);
		public stop = vi.fn();
		public getPublishedAlias = vi.fn().mockResolvedValue(undefined);

		constructor(homeserver: string, accessToken: string) {
			this.homeserver = homeserver;
			this.accessToken = accessToken;
			mockInstances.push(this as unknown as MockClientInstance);
		}

		on(event: string, handler: (roomId: string, event: Record<string, unknown>) => void) {
			this.handlers.set(event, handler);
		}
	},
	SimpleFsStorageProvider: class {},
	AutojoinRoomsMixin: { setupOnClient: mockSetupOnClient },
}));

import { MatrixClientPool } from "../../core/daemon/matrix-client-pool.js";

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

describe("MatrixClientPool", () => {
	let dir: string;
	let credentialsDir: string;
	let storageDir: string;
	const agents = [makeAgent("host", "@pi:bloom", "host"), makeAgent("planner", "@planner:bloom", "mentioned")];

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "matrix-client-pool-"));
		credentialsDir = join(dir, "credentials");
		storageDir = join(dir, "state");
		mkdirSync(credentialsDir, { recursive: true });
		mkdirSync(storageDir, { recursive: true });

		writeFileSync(
			join(credentialsDir, "host.json"),
			JSON.stringify({
				homeserver: "http://localhost:6167",
				userId: "@pi:bloom",
				accessToken: "host-token",
				password: "host-pass",
				username: "pi",
			}),
		);
		writeFileSync(
			join(credentialsDir, "planner.json"),
			JSON.stringify({
				homeserver: "http://localhost:6167",
				userId: "@planner:bloom",
				accessToken: "planner-token",
				password: "planner-pass",
				username: "planner",
			}),
		);

		mockInstances.length = 0;
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("starts one Matrix client per configured agent", async () => {
		const pool = new MatrixClientPool({
			agents,
			credentialsDir,
			storageDir,
			onEvent: vi.fn(),
		});

		await pool.start();

		expect(mockInstances).toHaveLength(2);
		expect(mockInstances.map((instance) => instance.accessToken)).toEqual(["host-token", "planner-token"]);
		expect(mockInstances.every((instance) => instance.start.mock.calls.length === 1)).toBe(true);
		expect(mockSetupOnClient).toHaveBeenCalledTimes(2);
		pool.stop();
	});

	it("dedupes the same Matrix event observed by multiple clients", async () => {
		const onEvent = vi.fn();
		const pool = new MatrixClientPool({
			agents,
			credentialsDir,
			storageDir,
			onEvent,
		});

		await pool.start();

		const hostHandler = mockInstances[0]?.handlers.get("room.message");
		const plannerHandler = mockInstances[1]?.handlers.get("room.message");
		expect(hostHandler).toBeDefined();
		expect(plannerHandler).toBeDefined();

		const event = {
			sender: "@alex:bloom",
			content: { msgtype: "m.text", body: "hey @planner:bloom" },
			event_id: "$evt1",
		};

		hostHandler?.("!room:bloom", event);
		plannerHandler?.("!room:bloom", event);
		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(onEvent).toHaveBeenCalledTimes(1);
		expect(onEvent).toHaveBeenCalledWith({
			roomId: "!room:bloom",
			eventId: "$evt1",
			senderUserId: "@alex:bloom",
			body: "hey @planner:bloom",
			senderKind: "human",
			mentions: ["@planner:bloom"],
			timestamp: expect.any(Number),
		});
		pool.stop();
	});

	it("routes sendText and setTyping through the correct agent client", async () => {
		const pool = new MatrixClientPool({
			agents,
			credentialsDir,
			storageDir,
			onEvent: vi.fn(),
		});

		await pool.start();
		await pool.sendText("planner", "!room:bloom", "hello from planner");
		await pool.setTyping("host", "!room:bloom", true, 15_000);

		expect(mockInstances[1]?.sendText).toHaveBeenCalledWith("!room:bloom", "hello from planner");
		expect(mockInstances[0]?.setTyping).toHaveBeenCalledWith("!room:bloom", true, 15_000);
		pool.stop();
	});

	it("ignores self-events from the receiving agent client", async () => {
		const onEvent = vi.fn();
		const pool = new MatrixClientPool({
			agents,
			credentialsDir,
			storageDir,
			onEvent,
		});

		await pool.start();

		const hostHandler = mockInstances[0]?.handlers.get("room.message");
		hostHandler?.("!room:bloom", {
			sender: "@pi:bloom",
			content: { msgtype: "m.text", body: "I sent this" },
			event_id: "$evt2",
		});
		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(onEvent).not.toHaveBeenCalled();
		pool.stop();
	});

	it("expires seen event ids so old event ids do not stay pinned forever", async () => {
		const onEvent = vi.fn();
		const pool = new MatrixClientPool({
			agents,
			credentialsDir,
			storageDir,
			onEvent,
		});

		await pool.start();

		const hostHandler = mockInstances[0]?.handlers.get("room.message");
		expect(hostHandler).toBeDefined();

		hostHandler?.("!room:bloom", {
			sender: "@alex:bloom",
			content: { msgtype: "m.text", body: "first" },
			event_id: "$evt-expire",
			origin_server_ts: 1_000,
		});
		hostHandler?.("!room:bloom", {
			sender: "@alex:bloom",
			content: { msgtype: "m.text", body: "second" },
			event_id: "$evt-expire",
			origin_server_ts: 700_001,
		});
		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(onEvent).toHaveBeenCalledTimes(2);
		pool.stop();
	});
});
