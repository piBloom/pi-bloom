/**
 * 📡 bloom-channels — Channel bridge Unix socket server at $XDG_RUNTIME_DIR/bloom/channels.sock.
 *
 * @commands /wa (send message to WhatsApp channel)
 * @hooks session_start, agent_end, session_shutdown
 * @see {@link ../AGENTS.md#bloom-channels} Extension reference
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import os from "node:os";
import { dirname, join } from "node:path";
import type {
	AgentEndEvent,
	ExtensionAPI,
	ExtensionContext,
	SessionShutdownEvent,
	SessionStartEvent,
} from "@mariozechner/pi-coding-agent";
import { createLogger } from "../lib/shared.js";

const log = createLogger("bloom-channels");

/** State tracking for a connected channel bridge socket. */
interface ChannelInfo {
	socket: Socket;
	connected: boolean;
	missedPings: number;
	pingTimer?: ReturnType<typeof setInterval>;
	pendingCount: number;
	rateBurst: number;
	rateTimer?: ReturnType<typeof setInterval>;
}

/** Context attached to a pending inbound channel message awaiting response. */
interface ChannelContext {
	channel: string;
	from: string;
	createdAt: number;
}

interface MediaInfo {
	kind: string;
	mimetype: string;
	filepath: string;
	duration?: number;
	size: number;
	caption?: string;
}

interface IncomingMessage {
	type: "register" | "message" | "pong";
	id?: string;
	channel: string;
	token?: string;
	from?: string;
	text?: string;
	timestamp?: number;
	media?: MediaInfo;
}

const defaultSocketPath = join(
	process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid?.() ?? 1000}`,
	"bloom",
	"channels.sock",
);
const SOCKET_PATH = process.env.BLOOM_CHANNELS_SOCKET ?? defaultSocketPath;
const TOKEN_DIR = join(os.homedir(), ".config", "bloom", "channel-tokens");
const PING_INTERVAL_MS = 30_000;
const MAX_MISSED_PINGS = 3;
const MAX_PENDING_PER_CHANNEL = 10;
const RATE_LIMIT_PER_SEC = 1;
const RATE_BURST = 5;
const PENDING_SWEEP_INTERVAL_MS = 5 * 60_000;
const PENDING_MAX_AGE_MS = 10 * 60_000;

function loadToken(channel: string): string | null {
	try {
		return readFileSync(join(TOKEN_DIR, channel), "utf-8").trim();
	} catch {
		return null;
	}
}

/**
 * Extract text from the last assistant message in a conversation.
 * Handles multimodal responses (concatenates text parts, skips tool_use),
 * empty responses (tool-only turns), and post-compaction message arrays.
 */
// biome-ignore lint/suspicious/noExplicitAny: accepts SDK AgentMessage[] without coupling to SDK types
export function extractResponseText(messages: readonly any[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i] as Record<string, unknown>;
		if (!("role" in msg) || msg.role !== "assistant") continue;

		const content = (msg as { role: "assistant"; content: unknown }).content;

		// Handle string content (post-compaction summaries)
		if (typeof content === "string") return content;

		// Handle array content blocks
		if (Array.isArray(content)) {
			const textParts = (content as Array<{ type: string; text?: string }>)
				.filter((c) => c.type === "text" && c.text)
				.map((c) => c.text as string);
			if (textParts.length > 0) return textParts.join("\n\n");
		}
	}
	return "";
}

export default function (pi: ExtensionAPI) {
	const channelTokens = new Map<string, string>();
	const channels = new Map<string, ChannelInfo>();
	const pendingContexts = new Map<string, ChannelContext>();
	let server: Server | null = null;
	let lastCtx: ExtensionContext | null = null;
	let pendingSweepTimer: ReturnType<typeof setInterval> | null = null;

	function updateWidget(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		const lines: string[] = [];
		for (const [name, info] of channels) {
			lines.push(`${name}: ${info.connected ? "connected" : "disconnected"}`);
		}
		if (lines.length > 0) {
			ctx.ui.setWidget("bloom-channels", lines);
		} else {
			ctx.ui.setWidget("bloom-channels", undefined);
		}
		ctx.ui.setStatus("bloom-channels", `Channels: ${channels.size} connected`);
	}

	function clearChannelTimers(info: ChannelInfo): void {
		if (info.pingTimer) {
			clearInterval(info.pingTimer);
			info.pingTimer = undefined;
		}
		if (info.rateTimer) {
			clearInterval(info.rateTimer);
			info.rateTimer = undefined;
		}
	}

	function removeChannel(name: string): void {
		const info = channels.get(name);
		if (!info) return;
		clearChannelTimers(info);
		channels.delete(name);
		if (lastCtx) updateWidget(lastCtx);
	}

	function removeChannelBySocket(socket: Socket): string | null {
		for (const [name, info] of channels) {
			if (info.socket === socket) {
				removeChannel(name);
				return name;
			}
		}
		return null;
	}

	function sendToSocket(socket: Socket, obj: object): void {
		socket.write(`${JSON.stringify(obj)}\n`);
	}

	function startHeartbeat(name: string, info: ChannelInfo): void {
		info.pingTimer = setInterval(() => {
			info.missedPings++;
			if (info.missedPings > MAX_MISSED_PINGS) {
				log.warn("missed pings, disconnecting", { channel: name });
				clearChannelTimers(info);
				if (!info.socket.destroyed) info.socket.destroy();
				return;
			}
			sendToSocket(info.socket, { type: "ping" });
		}, PING_INTERVAL_MS);
	}

	function startRateRefill(info: ChannelInfo): void {
		info.rateTimer = setInterval(() => {
			if (info.rateBurst < RATE_BURST) info.rateBurst++;
		}, 1000 / RATE_LIMIT_PER_SEC);
	}

	function handleSocketData(socket: Socket, data: string): void {
		const lines = data.split("\n");
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			let msg: IncomingMessage;
			try {
				msg = JSON.parse(trimmed) as IncomingMessage;
			} catch {
				log.error("failed to parse message", { raw: trimmed.slice(0, 200) });
				continue;
			}

			if (msg.type === "pong") {
				for (const [, info] of channels) {
					if (info.socket === socket) {
						info.missedPings = 0;
						break;
					}
				}
				continue;
			}

			if (msg.type === "register") {
				const name = msg.channel;
				const expectedToken = loadToken(name);
				if (!expectedToken) {
					sendToSocket(socket, { type: "error", reason: "missing channel token" });
					log.warn("rejected registration: missing token", { channel: name });
					socket.destroy();
					return;
				}
				if (msg.token !== expectedToken) {
					sendToSocket(socket, { type: "error", reason: "invalid token" });
					log.warn("rejected registration: invalid token", { channel: name });
					socket.destroy();
					return;
				}
				const existing = channels.get(name);
				if (existing) {
					clearChannelTimers(existing);
					channels.delete(name);
					if (existing.socket !== socket && !existing.socket.destroyed) {
						existing.socket.destroy();
					}
					log.info("replaced channel connection", { channel: name });
				}

				channelTokens.set(name, expectedToken);
				const info: ChannelInfo = { socket, connected: true, missedPings: 0, pendingCount: 0, rateBurst: RATE_BURST };
				channels.set(name, info);
				startHeartbeat(name, info);
				startRateRefill(info);
				sendToSocket(socket, { type: "status", connected: true });
				if (lastCtx) updateWidget(lastCtx);
				log.info("channel registered", { channel: name });
			} else if (msg.type === "message") {
				const channel = msg.channel;
				const channelInfo = channels.get(channel);

				// Backpressure: check queue depth
				if (channelInfo && channelInfo.pendingCount >= MAX_PENDING_PER_CHANNEL) {
					const errorId = msg.id ?? randomUUID();
					sendToSocket(socket, { type: "error", id: errorId, reason: "queue full" });
					log.warn("queue full, rejecting message", { channel });
					continue;
				}

				// Rate limiting
				if (channelInfo && channelInfo.rateBurst <= 0) {
					const errorId = msg.id ?? randomUUID();
					sendToSocket(socket, { type: "error", id: errorId, reason: "rate limited" });
					log.warn("rate limited", { channel });
					continue;
				}

				if (channelInfo) {
					channelInfo.rateBurst--;
					channelInfo.pendingCount++;
				}

				const from = msg.from ?? "unknown";
				const messageId = msg.id ?? randomUUID();

				pendingContexts.set(messageId, { channel, from, createdAt: Date.now() });

				let prompt: string;
				if (msg.media) {
					const m = msg.media;
					const sizeKB = Math.round(m.size / 1024);
					const duration = m.duration ? ` ${m.duration}s,` : "";
					prompt = `[${channel}: ${from}] sent ${m.kind} (${duration} ${sizeKB}KB, ${m.mimetype}). File: ${m.filepath}`;
					if (m.caption) prompt += `\nCaption: ${m.caption}`;
				} else {
					prompt = `[${channel}: ${from}] ${msg.text ?? ""}`;
				}

				// Tag the prompt with the message ID for correlation
				prompt = `[msgId:${messageId}] ${prompt}`;

				if (lastCtx?.isIdle()) {
					pi.sendUserMessage(prompt);
				} else {
					pi.sendUserMessage(prompt, { deliverAs: "followUp" });
				}
			}
		}
	}

	pi.on("session_start", (_event: SessionStartEvent, ctx: ExtensionContext) => {
		lastCtx = ctx;

		// Clean up stale socket file
		if (existsSync(SOCKET_PATH)) {
			try {
				unlinkSync(SOCKET_PATH);
			} catch {
				log.error("could not remove stale socket", { path: SOCKET_PATH });
			}
		}

		server = createServer((socket: Socket) => {
			let buffer = "";

			socket.on("data", (chunk: Buffer) => {
				buffer += chunk.toString();
				const newlineIdx = buffer.lastIndexOf("\n");
				if (newlineIdx === -1) return;
				const complete = buffer.slice(0, newlineIdx + 1);
				buffer = buffer.slice(newlineIdx + 1);
				handleSocketData(socket, complete);
			});

			socket.on("error", (err: Error) => {
				const channel = removeChannelBySocket(socket);
				if (channel) {
					log.error("socket error", { channel, error: err.message });
				} else {
					log.error("socket error", { error: err.message });
				}
			});

			socket.on("close", () => {
				const channel = removeChannelBySocket(socket);
				if (channel) {
					log.info("channel disconnected", { channel });
				}
			});
		});

		server.on("error", (err: Error) => {
			log.error("server error", { error: err.message });
		});

		mkdirSync(dirname(SOCKET_PATH), { recursive: true });
		server.listen(SOCKET_PATH, () => {
			log.info("listening", { path: SOCKET_PATH });
		});

		pendingSweepTimer = setInterval(() => {
			const now = Date.now();
			for (const [id, ctx] of pendingContexts) {
				if (now - ctx.createdAt > PENDING_MAX_AGE_MS) {
					pendingContexts.delete(id);
					const channelInfo = channels.get(ctx.channel);
					if (channelInfo) channelInfo.pendingCount = Math.max(0, channelInfo.pendingCount - 1);
					log.warn("expired pending context", { id, channel: ctx.channel });
				}
			}
		}, PENDING_SWEEP_INTERVAL_MS);

		updateWidget(ctx);
	});

	pi.on("agent_end", (event: AgentEndEvent, ctx: ExtensionContext) => {
		lastCtx = ctx;
		if (pendingContexts.size === 0) return;

		// Find the message ID from the user prompt that triggered this agent turn
		const userMessages = event.messages.filter((m) => "role" in m && m.role === "user");
		let matchedId: string | undefined;
		for (const um of userMessages) {
			const content = (um as { role: "user"; content: unknown }).content;
			const text = typeof content === "string" ? content : "";
			const match = text.match(/\[msgId:([^\]]+)\]/);
			if (match) {
				matchedId = match[1];
				break;
			}
		}

		// Fall back to most recent pending context if no ID match
		const contextId = matchedId ?? [...pendingContexts.keys()].pop();
		if (!contextId) return;

		const channelCtx = pendingContexts.get(contextId);
		if (!channelCtx) return;
		pendingContexts.delete(contextId);

		// Decrement pending counter
		const channelInfo = channels.get(channelCtx.channel);
		if (!channelInfo) return;
		channelInfo.pendingCount = Math.max(0, channelInfo.pendingCount - 1);

		const responseText = extractResponseText(event.messages);

		if (responseText) {
			sendToSocket(channelInfo.socket, {
				type: "response",
				id: contextId,
				channel: channelCtx.channel,
				to: channelCtx.from,
				text: responseText,
			});
		}
	});

	pi.on("session_shutdown", (_event: SessionShutdownEvent, _ctx: ExtensionContext) => {
		if (pendingSweepTimer) {
			clearInterval(pendingSweepTimer);
			pendingSweepTimer = null;
		}
		if (server) {
			server.close();
			server = null;
		}
		// Clean up socket file
		if (existsSync(SOCKET_PATH)) {
			try {
				unlinkSync(SOCKET_PATH);
			} catch {
				// Ignore cleanup errors
			}
		}
		for (const [, info] of channels) {
			if (info.pingTimer) clearInterval(info.pingTimer);
			if (info.rateTimer) clearInterval(info.rateTimer);
			info.socket.destroy();
		}
		channels.clear();
		pendingContexts.clear();
	});

	pi.registerCommand("wa", {
		description: "Send a message to WhatsApp",
		handler: async (args: string, ctx) => {
			const waChannel = channels.get("whatsapp");
			if (!waChannel) {
				ctx.ui.notify("WhatsApp not connected", "warning");
				return;
			}
			const msg = `${JSON.stringify({ type: "send", channel: "whatsapp", text: args })}\n`;
			waChannel.socket.write(msg);
			ctx.ui.notify("Sent to WhatsApp", "info");
		},
	});
}
