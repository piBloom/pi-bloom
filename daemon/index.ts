/**
 * Pi Daemon — always-on Matrix room agent.
 *
 * Entry point: wires MatrixListener to per-room pi --mode rpc subprocesses.
 * Each room gets its own pi process, managed by RoomProcess.
 */
import { mkdirSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { matrixCredentialsPath } from "../lib/matrix.js";
import { sanitizeRoomAlias } from "../lib/room-alias.js";
import { createLogger } from "../lib/shared.js";
import { type IncomingMessage, MatrixListener } from "./matrix-listener.js";
import { RoomProcess } from "./room-process.js";
import type { RpcEvent } from "./rpc-protocol.js";

const log = createLogger("pi-daemon");

const IDLE_TIMEOUT_MS = Number.parseInt(process.env.BLOOM_DAEMON_IDLE_TIMEOUT_MS ?? "", 10) || 15 * 60 * 1000;
const SESSION_BASE = join(os.homedir(), ".pi", "agent", "sessions", "bloom-rooms");
const STORAGE_PATH = join(os.homedir(), ".pi", "pi-daemon", "matrix-state.json");
const SOCKET_DIR = join(process.env.XDG_RUNTIME_DIR ?? join(os.homedir(), ".run"), "bloom");
const TYPING_TIMEOUT_MS = 30_000;
const TYPING_REFRESH_MS = 20_000;

// Track auth errors for cascading restart
let authErrorCount = 0;
let authErrorWindowStart = 0;
const AUTH_ERROR_WINDOW_MS = 60_000;
const AUTH_ERROR_THRESHOLD = 2;

async function main(): Promise<void> {
	log.info("starting pi-daemon", { idleTimeoutMs: IDLE_TIMEOUT_MS, socketDir: SOCKET_DIR });

	mkdirSync(SOCKET_DIR, { recursive: true });

	const rooms = new Map<string, RoomProcess>();
	const preambleSent = new Set<string>(); // track which rooms have received system preamble

	const listener = new MatrixListener({
		credentialsPath: matrixCredentialsPath(),
		storagePath: STORAGE_PATH,
		onMessage: (roomId, message) => {
			void handleMessage(roomId, message);
		},
	});
	const typingIntervals = new Map<string, ReturnType<typeof setInterval>>();

	function startTyping(roomId: string): void {
		if (typingIntervals.has(roomId)) return;

		void listener.setTyping(roomId, true, TYPING_TIMEOUT_MS).catch((err) => {
			log.warn("failed to set typing=true", { roomId, error: String(err) });
		});

		const interval = setInterval(() => {
			void listener.setTyping(roomId, true, TYPING_TIMEOUT_MS).catch((err) => {
				log.warn("failed to refresh typing state", { roomId, error: String(err) });
			});
		}, TYPING_REFRESH_MS);
		interval.unref();
		typingIntervals.set(roomId, interval);
	}

	function stopTyping(roomId: string): void {
		const interval = typingIntervals.get(roomId);
		if (!interval) return;

		clearInterval(interval);
		typingIntervals.delete(roomId);

		void listener.setTyping(roomId, false).catch((err) => {
			log.warn("failed to set typing=false", { roomId, error: String(err) });
		});
	}

	function handleRoomEvent(roomId: string, event: RpcEvent): void {
		if (event.type === "agent_start") {
			startTyping(roomId);
		} else if (event.type === "agent_end") {
			stopTyping(roomId);
		}
	}

	async function getOrSpawn(roomId: string, alias: string): Promise<RoomProcess> {
		const existing = rooms.get(roomId);
		if (existing?.alive) return existing;

		// Clean up dead entry if present
		if (existing) rooms.delete(roomId);

		const sanitized = sanitizeRoomAlias(alias);
		const sessionDir = join(SESSION_BASE, sanitized);

		const rp = new RoomProcess({
			roomId,
			roomAlias: alias,
			sanitizedAlias: sanitized,
			socketDir: SOCKET_DIR,
			sessionDir,
			idleTimeoutMs: IDLE_TIMEOUT_MS,
			onAgentEnd: async (text) => {
				try {
					await listener.sendText(roomId, text);
				} catch (err) {
					log.error("failed to send response to Matrix", { roomId, error: String(err) });
				}
			},
			onEvent: (event) => {
				handleRoomEvent(roomId, event);
			},
			onExit: (_code) => {
				rooms.delete(roomId);
				preambleSent.delete(roomId);
				stopTyping(roomId);
				if (_code !== 0 && _code !== null) {
					handleProcessError(roomId, _code);
				}
			},
		});

		await rp.spawn();
		rooms.set(roomId, rp);
		return rp;
	}

	async function handleMessage(roomId: string, message: IncomingMessage): Promise<void> {
		try {
			const alias = await listener.getRoomAlias(roomId);
			const rp = await getOrSpawn(roomId, alias);

			log.info("routing message", { roomId, sender: message.sender });

			// First message to a fresh process includes system preamble
			const prefix = `[matrix: ${message.sender}] `;
			if (!preambleSent.has(roomId)) {
				const preamble = `[system] You are Pi in Matrix room ${alias}. Respond to messages from this room.\n\n`;
				rp.sendMessage(preamble + prefix + message.body);
				preambleSent.add(roomId);
			} else {
				rp.sendMessage(prefix + message.body);
			}
		} catch (err) {
			const errStr = String(err);
			log.error("failed to handle message", { roomId, error: errStr });
			stopTyping(roomId);

			try {
				await listener.sendText(roomId, "Sorry, I hit an error processing your message. Please try again.");
			} catch {
				/* best effort */
			}
		}
	}

	function handleProcessError(_roomId: string, _code: number): void {
		const now = Date.now();
		if (now - authErrorWindowStart > AUTH_ERROR_WINDOW_MS) {
			authErrorCount = 0;
			authErrorWindowStart = now;
		}
		authErrorCount++;

		if (authErrorCount >= AUTH_ERROR_THRESHOLD) {
			log.error("multiple process failures detected, exiting for systemd restart");
			shutdown("PROCESS_FAILURES");
		}
	}

	async function shutdown(signal: string): Promise<void> {
		log.info("shutting down", { signal });
		for (const roomId of [...typingIntervals.keys()]) {
			stopTyping(roomId);
		}
		listener.stop();
		for (const rp of rooms.values()) {
			rp.dispose();
		}
		rooms.clear();
		// Wait up to 5 seconds for child processes to exit
		await new Promise((r) => setTimeout(r, 5000));
		process.exit(0);
	}

	process.on("SIGTERM", () => void shutdown("SIGTERM"));
	process.on("SIGINT", () => void shutdown("SIGINT"));

	// Start with retry
	let retryDelay = 5000;
	const maxDelay = 300_000;

	while (true) {
		try {
			await listener.start();
			log.info("pi-daemon running");
			break;
		} catch (err) {
			log.error("failed to start Matrix listener, retrying", {
				error: String(err),
				retryMs: retryDelay,
			});
			await new Promise((r) => setTimeout(r, retryDelay));
			retryDelay = Math.min(retryDelay * 3, maxDelay);
		}
	}
}

main().catch((err) => {
	log.error("fatal error", { error: String(err) });
	process.exit(1);
});
