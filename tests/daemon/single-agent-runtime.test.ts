import { describe, expect, it, vi } from "vitest";

import type { MatrixTextEvent } from "../../core/daemon/contracts/matrix.js";
import type { SessionEvent } from "../../core/daemon/contracts/session.js";
import { createSingleAgentRuntime } from "../../core/daemon/single-agent-runtime.js";

class FakeSession {
	public alive = true;
	public sentMessages: string[] = [];
	public readonly spawn = vi.fn(async () => undefined);
	public readonly dispose = vi.fn(() => {
		this.alive = false;
	});

	constructor(
		public readonly opts: {
			onAgentEnd: (text: string) => void;
			onEvent: (event: SessionEvent) => void;
			onExit: (code: number | null) => void;
		},
	) {}

	async sendMessage(text: string): Promise<void> {
		this.sentMessages.push(text);
	}

	triggerEvent(event: SessionEvent): void {
		this.opts.onEvent(event);
	}
}

describe("createSingleAgentRuntime", () => {
	it("sends a fallback apology message when handling a room message fails", async () => {
		const bridge = {
			onTextEvent: vi.fn(),
			start: vi.fn(async () => undefined),
			stop: vi.fn(),
			sendText: vi.fn(async () => undefined),
			setTyping: vi.fn(async () => undefined),
			getRoomAlias: vi.fn(async () => {
				throw new Error("alias lookup failed");
			}),
		};
		const runtime = createSingleAgentRuntime({
			storagePath: "/tmp/matrix-state.json",
			sessionBaseDir: "/tmp/sessions",
			idleTimeoutMs: 60_000,
			roomFailureWindowMs: 60_000,
			roomFailureThreshold: 3,
			roomQuarantineMs: 300_000,
			credentials: {
				homeserver: "http://localhost:6167",
				botUserId: "@pi:bloom",
				botAccessToken: "token",
				botPassword: "secret",
				registrationToken: "reg-token",
			},
			createBridge: () => bridge,
		});

		const message: MatrixTextEvent = {
			roomId: "!room:bloom",
			eventId: "$evt1",
			senderUserId: "@alex:bloom",
			body: "hello",
			timestamp: 1_000,
		};

		await runtime.handleMessage(message);

		expect(bridge.sendText).toHaveBeenCalledWith(
			"default",
			"!room:bloom",
			"Sorry, I hit an error processing your message. Please try again.",
		);
	});

	it("disposes active sessions and stops the bridge on shutdown", async () => {
		const createdSessions: FakeSession[] = [];
		const bridge = {
			onTextEvent: vi.fn(),
			start: vi.fn(async () => undefined),
			stop: vi.fn(),
			sendText: vi.fn(async () => undefined),
			setTyping: vi.fn(async () => undefined),
			getRoomAlias: vi.fn(async () => "#general:bloom"),
		};
		const runtime = createSingleAgentRuntime({
			storagePath: "/tmp/matrix-state.json",
			sessionBaseDir: "/tmp/sessions",
			idleTimeoutMs: 60_000,
			roomFailureWindowMs: 60_000,
			roomFailureThreshold: 3,
			roomQuarantineMs: 300_000,
			credentials: {
				homeserver: "http://localhost:6167",
				botUserId: "@pi:bloom",
				botAccessToken: "token",
				botPassword: "secret",
				registrationToken: "reg-token",
			},
			createBridge: () => bridge,
			createSession: (opts) => {
				const session = new FakeSession(opts);
				createdSessions.push(session);
				return session;
			},
		});

		await runtime.handleMessage({
			roomId: "!room:bloom",
			eventId: "$evt1",
			senderUserId: "@alex:bloom",
			body: "hello",
			timestamp: 1_000,
		});
		createdSessions[0]?.triggerEvent({ type: "agent_start" });

		await runtime.stop();

		expect(createdSessions[0]?.dispose).toHaveBeenCalledTimes(1);
		expect(bridge.stop).toHaveBeenCalledTimes(1);
		expect(bridge.setTyping).toHaveBeenCalledWith("default", "!room:bloom", false, 30_000);
	});

	it("retries startup until the bridge connects", async () => {
		const bridge = {
			onTextEvent: vi.fn(),
			start: vi
				.fn<() => Promise<void>>()
				.mockRejectedValueOnce(new Error("first"))
				.mockResolvedValue(undefined),
			stop: vi.fn(),
			sendText: vi.fn(async () => undefined),
			setTyping: vi.fn(async () => undefined),
			getRoomAlias: vi.fn(async () => "#general:bloom"),
		};
		const sleep = vi.fn(async (_delayMs: number) => undefined);
		const runtime = createSingleAgentRuntime({
			storagePath: "/tmp/matrix-state.json",
			sessionBaseDir: "/tmp/sessions",
			idleTimeoutMs: 60_000,
			roomFailureWindowMs: 60_000,
			roomFailureThreshold: 3,
			roomQuarantineMs: 300_000,
			credentials: {
				homeserver: "http://localhost:6167",
				botUserId: "@pi:bloom",
				botAccessToken: "token",
				botPassword: "secret",
				registrationToken: "reg-token",
			},
			createBridge: () => bridge,
			retryOptions: {
				initialDelayMs: 100,
				maxDelayMs: 1000,
				sleep,
			},
		});

		await runtime.start();

		expect(bridge.start).toHaveBeenCalledTimes(2);
		expect(sleep).toHaveBeenCalledWith(100);
	});
});
