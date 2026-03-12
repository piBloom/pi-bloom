/**
 * Session pool — manages AgentSession lifecycle for Matrix rooms.
 * Creates, resumes, and disposes sessions with LRU eviction.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import {
	type AgentSession,
	type AgentSessionEvent,
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionFactory,
	SessionManager,
} from "@mariozechner/pi-coding-agent";
import { createLogger } from "../lib/shared.js";
import type { RoomRegistry } from "./room-registry.js";

const log = createLogger("session-pool");

export interface SessionPoolOptions {
	registry: RoomRegistry;
	maxSessions: number;
	idleTimeoutMs: number;
	sessionDir: string;
	extensionFactories: ExtensionFactory[];
}

export type SessionEventHandler = (roomId: string, event: AgentSessionEvent) => void;

export class SessionPool {
	private readonly loaded = new Map<string, AgentSession>();
	private readonly inFlight = new Map<string, Promise<AgentSession>>();
	private readonly unsubscribers = new Map<string, () => void>();
	private readonly idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly options: SessionPoolOptions;
	private eventHandler: SessionEventHandler | undefined;

	constructor(options: SessionPoolOptions) {
		this.options = options;
	}

	/** Set a handler to receive session events for all rooms. */
	onEvent(handler: SessionEventHandler): void {
		this.eventHandler = handler;
	}

	/** Get or create a session for a room. Deduplicates concurrent calls for the same room. */
	async getOrCreate(roomId: string, roomAlias: string): Promise<AgentSession> {
		const existing = this.loaded.get(roomId);
		if (existing) {
			this.options.registry.touch(roomId);
			this.resetIdleTimer(roomId);
			return existing;
		}

		// Deduplicate concurrent creates for the same room
		const inflight = this.inFlight.get(roomId);
		if (inflight) return inflight;

		const promise = this.createSession(roomId, roomAlias).finally(() => {
			this.inFlight.delete(roomId);
		});
		this.inFlight.set(roomId, promise);
		return promise;
	}

	private async createSession(roomId: string, roomAlias: string): Promise<AgentSession> {
		// Evict LRU if at capacity
		if (this.loaded.size >= this.options.maxSessions) {
			this.evictLRU();
		}

		const entry = this.options.registry.get(roomId);
		const sessionDir = this.options.sessionDir;
		if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });

		let sessionManager: SessionManager;
		if (entry?.sessionPath && existsSync(entry.sessionPath)) {
			try {
				sessionManager = SessionManager.open(entry.sessionPath, sessionDir);
				log.info("resuming session", { roomId, path: entry.sessionPath });
			} catch (err) {
				log.warn("corrupted session file, creating fresh", { roomId, path: entry.sessionPath, error: String(err) });
				const corruptPath = `${entry.sessionPath}.corrupt.${Date.now()}`;
				try {
					renameSync(entry.sessionPath, corruptPath);
				} catch {
					/* best effort */
				}
				sessionManager = SessionManager.create(os.homedir(), sessionDir);
			}
		} else {
			sessionManager = SessionManager.create(os.homedir(), sessionDir);
			log.info("creating new session", { roomId, roomAlias });
		}

		const resourceLoader = new DefaultResourceLoader({
			cwd: os.homedir(),
			extensionFactories: this.options.extensionFactories,
			appendSystemPrompt: `You are Pi in Matrix room ${roomAlias}. Respond to messages from this room.`,
		});
		await resourceLoader.reload();

		const { session } = await createAgentSession({
			cwd: os.homedir(),
			sessionManager,
			resourceLoader,
		});

		// Subscribe to events and forward to handler
		const unsub = session.subscribe((event) => {
			this.eventHandler?.(roomId, event);
		});
		this.unsubscribers.set(roomId, unsub);
		this.loaded.set(roomId, session);
		this.resetIdleTimer(roomId);

		// Update registry
		const now = new Date().toISOString();
		this.options.registry.set(roomId, {
			roomAlias,
			sessionPath: session.sessionFile ?? join(sessionDir, `${randomUUID()}.jsonl`),
			created: entry?.created ?? now,
			lastActive: now,
		});

		return session;
	}

	/** Reset the idle timer for a room. Disposes session after idleTimeoutMs of inactivity. */
	private resetIdleTimer(roomId: string): void {
		const existing = this.idleTimers.get(roomId);
		if (existing) clearTimeout(existing);

		const timer = setTimeout(() => {
			this.disposeRoom(roomId);
		}, this.options.idleTimeoutMs);
		timer.unref(); // Don't keep process alive just for idle timers
		this.idleTimers.set(roomId, timer);
	}

	/** Evict the least-recently-used session among loaded sessions only. */
	private evictLRU(): void {
		let oldest: string | undefined;
		let oldestTime = Number.POSITIVE_INFINITY;

		for (const roomId of this.loaded.keys()) {
			const entry = this.options.registry.get(roomId);
			const t = entry ? new Date(entry.lastActive).getTime() : 0;
			if (t < oldestTime) {
				oldestTime = t;
				oldest = roomId;
			}
		}

		if (oldest) {
			this.disposeRoom(oldest);
			log.info("evicted LRU session", { roomId: oldest });
		}
	}

	/** Dispose a single room's session and clean up. */
	private disposeRoom(roomId: string): void {
		const session = this.loaded.get(roomId);
		if (!session) return;

		this.unsubscribers.get(roomId)?.();
		this.unsubscribers.delete(roomId);
		const timer = this.idleTimers.get(roomId);
		if (timer) clearTimeout(timer);
		this.idleTimers.delete(roomId);
		session.dispose();
		this.loaded.delete(roomId);
		log.info("disposed session", { roomId });
	}

	/** Number of currently loaded sessions. */
	loadedCount(): number {
		return this.loaded.size;
	}

	/** Dispose all loaded sessions (for graceful shutdown). */
	disposeAll(): void {
		for (const roomId of [...this.loaded.keys()]) {
			this.disposeRoom(roomId);
		}
	}
}
