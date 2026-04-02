import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
	type AgentSessionEvent,
	createAgentSession,
	createCodingTools,
	DefaultResourceLoader,
	SessionManager,
	SettingsManager,
} from "@mariozechner/pi-coding-agent";

export interface ChatSessionManagerOptions {
	/** Path to /usr/local/share/nixpi (the deployed app share dir). */
	nixpiShareDir: string;
	/** Directory where per-session JSONL files are stored, e.g. ~/.pi/chat-sessions */
	chatSessionsDir: string;
	idleTimeoutMs: number;
	maxSessions: number;
}

export type ChatEvent =
	| { type: "text"; content: string }
	| { type: "tool_call"; name: string; input: string }
	| { type: "tool_result"; name: string; output: string }
	| { type: "done" }
	| { type: "error"; message: string };

interface PiSession {
	prompt: (text: string) => Promise<void>;
	subscribe: (cb: (e: AgentSessionEvent) => void) => () => void;
	dispose: () => void;
}

interface SessionEntry {
	id: string;
	piSession: PiSession;
	unsubscribe: () => void;
	idleTimer: ReturnType<typeof setTimeout>;
	lastUsed: number;
}

export class ChatSessionManager {
	private readonly opts: ChatSessionManagerOptions;
	private readonly sessions = new Map<string, SessionEntry>();

	constructor(opts: ChatSessionManagerOptions) {
		this.opts = opts;
	}

	async getOrCreate(sessionId: string): Promise<void> {
		const existing = this.sessions.get(sessionId);
		if (existing) {
			this.resetIdle(existing);
			return;
		}

		// Evict oldest session if at capacity.
		if (this.sessions.size >= this.opts.maxSessions) {
			const oldest = [...this.sessions.values()].sort((a, b) => a.lastUsed - b.lastUsed)[0];
			if (oldest) this.evict(oldest.id);
		}

		const sessionDir = resolve(this.opts.chatSessionsDir, sessionId);
		await mkdir(sessionDir, { recursive: true });

		const settingsManager = SettingsManager.create(this.opts.nixpiShareDir);
		const resourceLoader = new DefaultResourceLoader({
			cwd: this.opts.nixpiShareDir,
			settingsManager,
		});
		await resourceLoader.reload();

		const { session } = await createAgentSession({
			cwd: sessionDir,
			resourceLoader,
			settingsManager,
			sessionManager: SessionManager.create(sessionDir),
			tools: createCodingTools(sessionDir),
		});

		const entry: SessionEntry = {
			id: sessionId,
			piSession: session as unknown as PiSession,
			unsubscribe: () => {},
			idleTimer: setTimeout(() => this.evict(sessionId), this.opts.idleTimeoutMs),
			lastUsed: Date.now(),
		};
		entry.idleTimer.unref();
		// Subscribe with a no-op to keep the session alive; real subscribers are per-turn.
		entry.unsubscribe = session.subscribe(() => {});
		this.sessions.set(sessionId, entry);
	}

	/** Send a message and yield streaming events until the turn is done. */
	async *sendMessage(sessionId: string, text: string): AsyncGenerator<ChatEvent> {
		await this.getOrCreate(sessionId);
		const entry = this.sessions.get(sessionId)!;
		this.resetIdle(entry);

		const queue: ChatEvent[] = [];
		let notify: (() => void) | null = null;
		let done = false;

		const unsub = entry.piSession.subscribe((event: AgentSessionEvent) => {
			const events = chatEventsFromAgentEvent(event, sessionId);
			if (events.length > 0) {
				queue.push(...events);
				notify?.();
				notify = null;
			}
			if (event.type === "agent_end") {
				done = true;
				notify?.();
				notify = null;
			}
		});

		// Fire and forget — the subscribe callback will receive events.
		entry.piSession.prompt(text).catch((err: unknown) => {
			queue.push({ type: "error", message: String(err) });
			done = true;
			notify?.();
			notify = null;
		});

		try {
			while (!done || queue.length > 0) {
				if (queue.length === 0 && !done) {
					await new Promise<void>((r) => {
						notify = r;
					});
				}
				while (queue.length > 0) {
					yield queue.shift()!;
				}
			}
			yield { type: "done" };
		} finally {
			unsub();
		}
	}

	delete(sessionId: string): void {
		this.evict(sessionId);
	}

	private evict(sessionId: string): void {
		const entry = this.sessions.get(sessionId);
		if (!entry) return;
		clearTimeout(entry.idleTimer);
		entry.unsubscribe();
		entry.piSession.dispose();
		this.sessions.delete(sessionId);
	}

	private resetIdle(entry: SessionEntry): void {
		clearTimeout(entry.idleTimer);
		entry.lastUsed = Date.now();
		entry.idleTimer = setTimeout(() => this.evict(entry.id), this.opts.idleTimeoutMs);
		entry.idleTimer.unref();
	}
}

// Tracks the last-seen full text per content-block index so we can emit only
// the incremental delta rather than the full accumulated string.
const textCursors = new Map<string, Map<number, number>>();

function chatEventsFromAgentEvent(event: AgentSessionEvent, sessionId: string): ChatEvent[] {
	if (event.type !== "message_update") return [];
	const events: ChatEvent[] = [];
	// message_update has a `message` field (AgentMessage), which is an AssistantMessage
	const msg = (event as { message?: { role?: string; content?: unknown[] } }).message;
	if (!msg?.content) return [];

	let cursors = textCursors.get(sessionId);
	if (!cursors) {
		cursors = new Map<number, number>();
		textCursors.set(sessionId, cursors);
	}

	(
		msg.content as {
			type: string;
			text?: string;
			name?: string;
			input?: unknown;
			content?: unknown;
		}[]
	).forEach((block, idx) => {
		if (block.type === "text" && block.text) {
			const prev = cursors?.get(idx) ?? 0;
			const delta = block.text.slice(prev);
			if (delta) {
				cursors?.set(idx, block.text.length);
				events.push({ type: "text", content: delta });
			}
		} else if (block.type === "tool_use" && block.name) {
			events.push({
				type: "tool_call",
				name: block.name,
				input: JSON.stringify(block.input ?? {}),
			});
		} else if (block.type === "tool_result" && block.name) {
			events.push({
				type: "tool_result",
				name: block.name,
				output: String(block.content ?? ""),
			});
		}
	});
	return events;
}
