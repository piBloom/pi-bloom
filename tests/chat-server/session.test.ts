import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatSessionManager } from "../../core/chat-server/session.js";

// We mock pi-coding-agent so tests don't need real LLM calls.
vi.mock("@mariozechner/pi-coding-agent", () => ({
	createAgentSession: vi.fn(),
	createCodingTools: vi.fn(() => []),
	DefaultResourceLoader: vi.fn().mockImplementation(function () {
		return { reload: vi.fn().mockResolvedValue(undefined) };
	}),
	SessionManager: { create: vi.fn(() => ({})) },
	SettingsManager: {
		create: vi.fn(() => ({
			getDefaultProvider: vi.fn(() => null),
			getDefaultModel: vi.fn(() => null),
		})),
	},
}));

import { createAgentSession } from "@mariozechner/pi-coding-agent";

// Shared mock session hoisted to module level so all describe blocks can access it.
let mockSession: {
	prompt: ReturnType<typeof vi.fn>;
	subscribe: ReturnType<typeof vi.fn>;
	dispose: ReturnType<typeof vi.fn>;
	isStreaming: boolean;
	model: unknown;
};

beforeEach(() => {
	let subscriber: ((e: unknown) => void) | null = null;
	mockSession = {
		prompt: vi.fn().mockResolvedValue(undefined),
		subscribe: vi.fn((cb: (e: unknown) => void) => {
			subscriber = cb;
			return () => {
				subscriber = null;
			};
		}),
		dispose: vi.fn(),
		isStreaming: false,
		model: null,
	};
	vi.mocked(createAgentSession).mockResolvedValue({
		session: mockSession as never,
		extensionsResult: {} as never,
	});
	// expose subscriber for tests
	(mockSession as unknown as { _emit: (e: unknown) => void })._emit = (e) => subscriber?.(e);
});

describe("ChatSessionManager", () => {
	it("creates a session on first getOrCreate", async () => {
		const manager = new ChatSessionManager({
			nixpiShareDir: "/mock/share",
			chatSessionsDir: "/tmp/chat-sessions",
			idleTimeoutMs: 5000,
			maxSessions: 4,
		});
		await manager.getOrCreate("test-id-1");
		expect(createAgentSession).toHaveBeenCalledOnce();
	});

	it("returns the same session on second getOrCreate with same id", async () => {
		const manager = new ChatSessionManager({
			nixpiShareDir: "/mock/share",
			chatSessionsDir: "/tmp/chat-sessions",
			idleTimeoutMs: 5000,
			maxSessions: 4,
		});
		await manager.getOrCreate("test-id-2");
		await manager.getOrCreate("test-id-2");
		expect(createAgentSession).toHaveBeenCalledOnce();
	});

	it("disposes old sessions when maxSessions is exceeded", async () => {
		const manager = new ChatSessionManager({
			nixpiShareDir: "/mock/share",
			chatSessionsDir: "/tmp/chat-sessions",
			idleTimeoutMs: 5000,
			maxSessions: 2,
		});
		await manager.getOrCreate("s1");
		await manager.getOrCreate("s2");
		await manager.getOrCreate("s3"); // should evict s1
		expect(mockSession.dispose).toHaveBeenCalledOnce();
	});

	it("delete removes and disposes a session", async () => {
		const manager = new ChatSessionManager({
			nixpiShareDir: "/mock/share",
			chatSessionsDir: "/tmp/chat-sessions",
			idleTimeoutMs: 5000,
			maxSessions: 4,
		});
		await manager.getOrCreate("del-test");
		manager.delete("del-test");
		expect(mockSession.dispose).toHaveBeenCalledOnce();
	});
});

// ---------------------------------------------------------------------------
// sendMessage — streaming and event mapping
// ---------------------------------------------------------------------------
describe("ChatSessionManager.sendMessage", () => {
	type Emitter = { _emit: (e: unknown) => void };

	it("yields text events from message_update with text blocks", async () => {
		const manager = new ChatSessionManager({
			nixpiShareDir: "/mock/share",
			chatSessionsDir: "/tmp/chat-sessions",
			idleTimeoutMs: 5000,
			maxSessions: 4,
		});

		mockSession.prompt.mockImplementation(async () => {
			// Emit a message_update then agent_end after a tick
			setTimeout(() => {
				(mockSession as unknown as Emitter)._emit({
					type: "message_update",
					message: { role: "assistant", content: [{ type: "text", text: "Hello!" }] },
				});
				(mockSession as unknown as Emitter)._emit({ type: "agent_end" });
			}, 0);
		});

		const events = [];
		for await (const event of manager.sendMessage("sess-text", "hi")) {
			events.push(event);
		}

		expect(events).toContainEqual({ type: "text", content: "Hello!" });
		expect(events[events.length - 1]).toEqual({ type: "done" });
	});

	it("yields tool_call events from tool_use blocks", async () => {
		const manager = new ChatSessionManager({
			nixpiShareDir: "/mock/share",
			chatSessionsDir: "/tmp/chat-sessions",
			idleTimeoutMs: 5000,
			maxSessions: 4,
		});

		mockSession.prompt.mockImplementation(async () => {
			setTimeout(() => {
				(mockSession as unknown as Emitter)._emit({
					type: "message_update",
					message: {
						role: "assistant",
						content: [{ type: "tool_use", name: "bash", input: { command: "ls" } }],
					},
				});
				(mockSession as unknown as Emitter)._emit({ type: "agent_end" });
			}, 0);
		});

		const events = [];
		for await (const event of manager.sendMessage("sess-tool", "run ls")) {
			events.push(event);
		}

		const toolEvent = events.find((e) => e.type === "tool_call");
		expect(toolEvent).toBeDefined();
		expect((toolEvent as { name: string }).name).toBe("bash");
		expect((toolEvent as { input: string }).input).toContain("ls");
	});

	it("yields error event when prompt rejects", async () => {
		const manager = new ChatSessionManager({
			nixpiShareDir: "/mock/share",
			chatSessionsDir: "/tmp/chat-sessions",
			idleTimeoutMs: 5000,
			maxSessions: 4,
		});

		mockSession.prompt.mockRejectedValue(new Error("LLM unavailable"));

		const events = [];
		for await (const event of manager.sendMessage("sess-err", "hello")) {
			events.push(event);
		}

		expect(events).toContainEqual({ type: "error", message: "Error: LLM unavailable" });
	});

	it("ignores message_update events without content", async () => {
		const manager = new ChatSessionManager({
			nixpiShareDir: "/mock/share",
			chatSessionsDir: "/tmp/chat-sessions",
			idleTimeoutMs: 5000,
			maxSessions: 4,
		});

		mockSession.prompt.mockImplementation(async () => {
			setTimeout(() => {
				// event with no message
				(mockSession as unknown as Emitter)._emit({ type: "message_update" });
				// event with message but no content
				(mockSession as unknown as Emitter)._emit({ type: "message_update", message: {} });
				(mockSession as unknown as Emitter)._emit({ type: "agent_end" });
			}, 0);
		});

		const events = [];
		for await (const event of manager.sendMessage("sess-empty", "hi")) {
			events.push(event);
		}

		// Only the done event — no spurious text/tool events
		expect(events).toEqual([{ type: "done" }]);
	});

	it("ignores non-message_update events", async () => {
		const manager = new ChatSessionManager({
			nixpiShareDir: "/mock/share",
			chatSessionsDir: "/tmp/chat-sessions",
			idleTimeoutMs: 5000,
			maxSessions: 4,
		});

		mockSession.prompt.mockImplementation(async () => {
			setTimeout(() => {
				(mockSession as unknown as Emitter)._emit({ type: "tool_start", name: "bash" });
				(mockSession as unknown as Emitter)._emit({ type: "agent_end" });
			}, 0);
		});

		const events = [];
		for await (const event of manager.sendMessage("sess-ignore", "hi")) {
			events.push(event);
		}

		expect(events).toEqual([{ type: "done" }]);
	});
});
