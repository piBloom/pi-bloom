import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PiRoomSessionOptions } from "../../core/daemon/pi-room-session.js";

type SessionListener = (event: Record<string, unknown>) => void;

const {
	mockPrompt,
	mockFollowUp,
	mockDispose,
	mockCreateCodingTools,
	mockLoaderReload,
	mockCreateAgentSession,
	mockFakeSession,
} = vi.hoisted(() => {
	let listener: SessionListener | null = null;
	const fakeSession = {
		isStreaming: false,
		prompt: vi.fn().mockResolvedValue(undefined),
		followUp: vi.fn().mockResolvedValue(undefined),
		dispose: vi.fn(),
		subscribe: vi.fn((fn: SessionListener) => {
			listener = fn;
			return () => {
				listener = null;
			};
		}),
		emit(event: Record<string, unknown>) {
			listener?.(event);
		},
	};

	return {
		mockPrompt: fakeSession.prompt,
		mockFollowUp: fakeSession.followUp,
		mockDispose: fakeSession.dispose,
		mockCreateCodingTools: vi.fn().mockReturnValue([]),
		mockLoaderReload: vi.fn().mockResolvedValue(undefined),
		mockCreateAgentSession: vi.fn().mockResolvedValue({
			session: fakeSession,
			extensionsResult: { extensions: [], errors: [], runtime: undefined },
		}),
		mockFakeSession: fakeSession,
	};
});

vi.mock("@mariozechner/pi-coding-agent", () => ({
	createAgentSession: mockCreateAgentSession,
	createCodingTools: mockCreateCodingTools,
	DefaultResourceLoader: class {
		reload = mockLoaderReload;
	},
	SessionManager: {
		create: vi.fn().mockReturnValue({}),
	},
	SettingsManager: {
		create: vi.fn().mockReturnValue({}),
	},
}));

describe("PiRoomSession", () => {
	let options: PiRoomSessionOptions;

	beforeEach(() => {
		const sessionDir = mkdtempSync(join(tmpdir(), "pi-room-session-"));
		options = {
			roomId: "!room:bloom",
			roomAlias: "#general:bloom",
			sanitizedAlias: "general_bloom",
			sessionDir,
			idleTimeoutMs: 60_000,
			onAgentEnd: vi.fn(),
			onEvent: vi.fn(),
			onExit: vi.fn(),
		};
		mockPrompt.mockClear();
		mockFollowUp.mockClear();
		mockDispose.mockClear();
		mockCreateCodingTools.mockClear();
		mockLoaderReload.mockClear();
		mockCreateAgentSession.mockClear();
		mockFakeSession.isStreaming = false;
	});

	it("creates a Pi SDK session and routes prompt then follow_up semantics", async () => {
		const { PiRoomSession } = await import("../../core/daemon/pi-room-session.js");
		const session = new PiRoomSession(options);

		await session.spawn();
		expect(mockCreateAgentSession).toHaveBeenCalledTimes(1);
		expect(mockCreateCodingTools).toHaveBeenCalledWith(options.sessionDir);

		await session.sendMessage("hello");
		expect(mockPrompt).toHaveBeenCalledWith("hello");
		expect(mockFollowUp).not.toHaveBeenCalled();

		await session.sendMessage("queued");
		expect(mockFollowUp).toHaveBeenCalledWith("queued");
	});

	it("forwards agent events and extracts final assistant text", async () => {
		const { PiRoomSession } = await import("../../core/daemon/pi-room-session.js");
		const session = new PiRoomSession(options);

		await session.spawn();
		mockFakeSession.emit({ type: "agent_start" });
		mockFakeSession.emit({
			type: "message_update",
			assistantMessageEvent: { type: "text_delta", delta: "hi" },
		});
		mockFakeSession.emit({
			type: "agent_end",
			messages: [{ role: "assistant", content: "done" }],
		});

		expect(options.onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "agent_start" }));
		expect(options.onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "message_update" }));
		expect(options.onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "agent_end" }));
		expect(options.onAgentEnd).toHaveBeenCalledWith("done");
	});

	it("disposes the underlying Pi session", async () => {
		const { PiRoomSession } = await import("../../core/daemon/pi-room-session.js");
		const session = new PiRoomSession(options);

		await session.spawn();
		session.dispose();

		expect(mockDispose).toHaveBeenCalled();
		expect(session.alive).toBe(false);
	});
});
