import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockStart = vi.fn().mockResolvedValue(undefined);
const mockStop = vi.fn();
const mockGetUserId = vi.fn().mockResolvedValue("@pi:bloom");
const mockSendText = vi.fn().mockResolvedValue("$event1");
const mockSetTyping = vi.fn().mockResolvedValue(undefined);
const mockOn = vi.fn();
const mockDmsUpdate = vi.fn().mockResolvedValue(undefined);

vi.mock("matrix-bot-sdk", () => ({
	MatrixClient: class {
		dms = { update: mockDmsUpdate };
		start = mockStart;
		stop = mockStop;
		getUserId = mockGetUserId;
		sendText = mockSendText;
		setTyping = mockSetTyping;
		on = mockOn;
	},
	SimpleFsStorageProvider: class {},
	AutojoinRoomsMixin: { setupOnClient: vi.fn() },
}));

import { MatrixListener } from "../../core/daemon/matrix-listener.js";

describe("MatrixListener", () => {
	let dir: string;
	let credsPath: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "matrix-listener-"));
		credsPath = join(dir, "credentials.json");
		writeFileSync(
			credsPath,
			JSON.stringify({
				homeserver: "http://localhost:6167",
				botUserId: "@pi:bloom",
				botAccessToken: "tok123",
				botPassword: "pass",
				registrationToken: "reg-token",
			}),
		);
		vi.clearAllMocks();
	});

	it("starts and connects to Matrix", async () => {
		const listener = new MatrixListener({
			credentialsPath: credsPath,
			storagePath: join(dir, "state.json"),
			onMessage: vi.fn(),
		});

		await listener.start();
		expect(mockStart).toHaveBeenCalled();
		expect(mockDmsUpdate).not.toHaveBeenCalled();
	});

	it("stops cleanly", async () => {
		const listener = new MatrixListener({
			credentialsPath: credsPath,
			storagePath: join(dir, "state.json"),
			onMessage: vi.fn(),
		});

		await listener.start();
		listener.stop();
		expect(mockStop).toHaveBeenCalled();
	});

	it("sends text to a room", async () => {
		const listener = new MatrixListener({
			credentialsPath: credsPath,
			storagePath: join(dir, "state.json"),
			onMessage: vi.fn(),
		});

		await listener.start();
		await listener.sendText("!abc:bloom", "Hello");
		expect(mockSendText).toHaveBeenCalledWith("!abc:bloom", "Hello");
	});

	it("sets typing state in a room", async () => {
		const listener = new MatrixListener({
			credentialsPath: credsPath,
			storagePath: join(dir, "state.json"),
			onMessage: vi.fn(),
		});

		await listener.start();
		await listener.setTyping("!abc:bloom", true, 15_000);
		expect(mockSetTyping).toHaveBeenCalledWith("!abc:bloom", true, 15_000);
	});

	it("calls onMessage when room.message fires", async () => {
		const onMessage = vi.fn();
		const listener = new MatrixListener({
			credentialsPath: credsPath,
			storagePath: join(dir, "state.json"),
			onMessage,
		});

		await listener.start();

		const roomMessageCall = mockOn.mock.calls.find((c) => c[0] === "room.message");
		expect(roomMessageCall).toBeDefined();

		const handler = roomMessageCall?.[1] as (roomId: string, event: Record<string, unknown>) => void;

		handler("!abc:bloom", {
			sender: "@user:bloom",
			content: { msgtype: "m.text", body: "Hello Pi" },
			event_id: "$evt1",
		});

		await new Promise((r) => setTimeout(r, 10));

		expect(onMessage).toHaveBeenCalledWith(
			"!abc:bloom",
			expect.objectContaining({ sender: "@user:bloom", body: "Hello Pi" }),
		);
	});

	it("ignores messages from the bot itself", async () => {
		const onMessage = vi.fn();
		const listener = new MatrixListener({
			credentialsPath: credsPath,
			storagePath: join(dir, "state.json"),
			onMessage,
		});

		await listener.start();

		const roomMessageCall = mockOn.mock.calls.find((c) => c[0] === "room.message");
		const handler = roomMessageCall?.[1] as (roomId: string, event: Record<string, unknown>) => void;

		handler("!abc:bloom", {
			sender: "@pi:bloom",
			content: { msgtype: "m.text", body: "I said something" },
			event_id: "$evt2",
		});

		await new Promise((r) => setTimeout(r, 10));

		expect(onMessage).not.toHaveBeenCalled();
	});
});
