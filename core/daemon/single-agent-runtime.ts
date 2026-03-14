import { join } from "node:path";
import { sanitizeRoomAlias } from "../lib/room-alias.js";
import type { MatrixCredentials } from "../lib/matrix.js";
import type { MatrixBridge, MatrixTextEvent } from "./contracts/matrix.js";
import type { BloomSessionLike, SessionEvent } from "./contracts/session.js";
import { startWithRetry, type RetryOptions } from "./lifecycle.js";
import type { RoomFailureState } from "./room-failures.js";
import { handleRoomProcessError } from "./room-failures.js";
import { MatrixJsSdkBridge } from "./runtime/matrix-js-sdk-bridge.js";
import { PiRoomSession, type PiRoomSessionOptions } from "./runtime/pi-room-session.js";

const DEFAULT_MATRIX_IDENTITY = "default";
const TYPING_TIMEOUT_MS = 30_000;
const TYPING_REFRESH_MS = 20_000;

export interface SingleAgentRuntime {
	start(): Promise<void>;
	stop(): Promise<void>;
	handleMessage(message: MatrixTextEvent): Promise<void>;
}

export interface SingleAgentRuntimeOptions {
	storagePath: string;
	sessionBaseDir: string;
	idleTimeoutMs: number;
	roomFailureWindowMs: number;
	roomFailureThreshold: number;
	roomQuarantineMs: number;
	credentials: MatrixCredentials;
	createBridge?: (credentials: MatrixCredentials) => MatrixBridge;
	createSession?: (options: PiRoomSessionOptions) => BloomSessionLike;
	retryOptions?: RetryOptions;
}

export function createSingleAgentRuntime(options: SingleAgentRuntimeOptions): SingleAgentRuntime {
	const rooms = new Map<string, BloomSessionLike>();
	const preambleSent = new Set<string>();
	const roomFailures = new Map<string, RoomFailureState>();
	const bridge =
		options.createBridge?.(options.credentials) ??
		new MatrixJsSdkBridge({
			identities: [
				{
					id: DEFAULT_MATRIX_IDENTITY,
					userId: options.credentials.botUserId,
					homeserver: options.credentials.homeserver,
					accessToken: options.credentials.botAccessToken,
					storagePath: options.storagePath,
					autojoin: true,
				},
			],
		});
	const typingIntervals = new Map<string, ReturnType<typeof setInterval>>();

	const createSession =
		options.createSession ?? ((sessionOptions: PiRoomSessionOptions) => new PiRoomSession(sessionOptions));

	function startTyping(roomId: string): void {
		if (typingIntervals.has(roomId)) return;

		void bridge.setTyping(DEFAULT_MATRIX_IDENTITY, roomId, true, TYPING_TIMEOUT_MS).catch(() => {});
		const interval = setInterval(() => {
			void bridge.setTyping(DEFAULT_MATRIX_IDENTITY, roomId, true, TYPING_TIMEOUT_MS).catch(() => {});
		}, TYPING_REFRESH_MS);
		interval.unref();
		typingIntervals.set(roomId, interval);
	}

	function stopTyping(roomId: string): void {
		const interval = typingIntervals.get(roomId);
		if (interval) {
			clearInterval(interval);
			typingIntervals.delete(roomId);
		}
		void bridge.setTyping(DEFAULT_MATRIX_IDENTITY, roomId, false, TYPING_TIMEOUT_MS).catch(() => {});
	}

	function handleRoomEvent(roomId: string, event: SessionEvent): void {
		if (event.type === "agent_start") {
			startTyping(roomId);
		} else if (event.type === "agent_end") {
			stopTyping(roomId);
		}
	}

	async function getOrSpawn(roomId: string, alias: string): Promise<BloomSessionLike> {
		const failureState = roomFailures.get(roomId);
		if (failureState && failureState.quarantinedUntil > Date.now()) {
			throw new Error("room temporarily quarantined after repeated failures");
		}

		const existing = rooms.get(roomId);
		if (existing?.alive) return existing;
		if (existing) rooms.delete(roomId);

		const sanitized = sanitizeRoomAlias(alias);
		const session = createSession({
			roomId,
			roomAlias: alias,
			sanitizedAlias: sanitized,
			sessionDir: join(options.sessionBaseDir, sanitized),
			idleTimeoutMs: options.idleTimeoutMs,
			onAgentEnd: async (text) => {
				await bridge.sendText(DEFAULT_MATRIX_IDENTITY, roomId, text);
			},
			onEvent: (event) => {
				handleRoomEvent(roomId, event);
			},
			onExit: (code) => {
				rooms.delete(roomId);
				preambleSent.delete(roomId);
				stopTyping(roomId);
				if (code !== 0 && code !== null) {
					handleRoomProcessError(roomId, code, roomFailures, {
						roomFailureWindowMs: options.roomFailureWindowMs,
						roomFailureThreshold: options.roomFailureThreshold,
						roomQuarantineMs: options.roomQuarantineMs,
					});
				}
			},
		});

		await session.spawn();
		rooms.set(roomId, session);
		return session;
	}

	async function handleMessage(message: MatrixTextEvent): Promise<void> {
		try {
			const alias = await bridge.getRoomAlias(DEFAULT_MATRIX_IDENTITY, message.roomId);
			const session = await getOrSpawn(message.roomId, alias);
			const prefix = `[matrix: ${message.senderUserId}] `;

			if (!preambleSent.has(message.roomId)) {
				const preamble = `[system] You are Pi in Matrix room ${alias}. Respond to messages from this room.\n\n`;
				await session.sendMessage(preamble + prefix + message.body);
				preambleSent.add(message.roomId);
			} else {
				await session.sendMessage(prefix + message.body);
			}
		} catch {
			stopTyping(message.roomId);
			try {
				await bridge.sendText(
					DEFAULT_MATRIX_IDENTITY,
					message.roomId,
					"Sorry, I hit an error processing your message. Please try again.",
				);
			} catch {
				/* best effort */
			}
		}
	}

	bridge.onTextEvent((_identityId, event) => {
		void handleMessage(event);
	});

	return {
		async start() {
			await startWithRetry(async () => {
				await bridge.start();
			}, undefined, options.retryOptions);
		},
		async stop() {
			for (const roomId of [...typingIntervals.keys()]) {
				stopTyping(roomId);
			}
			bridge.stop();
			for (const session of rooms.values()) {
				session.dispose();
			}
			rooms.clear();
		},
		handleMessage,
	};
}
