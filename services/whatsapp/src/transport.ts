import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createConnection, type Socket } from "node:net";
import type { Boom } from "@hapi/boom";
import makeWASocket, {
	DisconnectReason,
	type DownloadableMessage,
	downloadContentFromMessage,
	getContentType,
	type MediaType,
	useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
import { isChannelMessage, mimeToExt } from "./utils.js";

const AUTH_DIR = process.env.BLOOM_AUTH_DIR ?? "/data/auth";
const defaultSocketPath = `${process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid?.() ?? 1000}`}/bloom/channels.sock`;
const CHANNELS_SOCKET = process.env.BLOOM_CHANNELS_SOCKET ?? defaultSocketPath;
const MEDIA_DIR = process.env.BLOOM_MEDIA_DIR ?? "/media/bloom";
const CHANNEL_TOKEN = process.env.BLOOM_CHANNEL_TOKEN ?? "";

const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;

const logger = pino({ level: process.env.LOG_LEVEL ?? "warn" });

// TCP state
let channelSocket: Socket | null = null;
let tcpBuffer = "";
let tcpReconnectDelay = RECONNECT_BASE_MS;
let tcpReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let tcpConnecting = false;
let shuttingDown = false;
let waConnected = false;

// Track WhatsApp socket
let waSock: ReturnType<typeof makeWASocket> | null = null;

function clearTcpReconnectTimer(): void {
	if (tcpReconnectTimer) {
		clearTimeout(tcpReconnectTimer);
		tcpReconnectTimer = null;
	}
}

function resetChannelSocket(): void {
	const sock = channelSocket;
	channelSocket = null;
	tcpConnecting = false;
	if (sock && !sock.destroyed) sock.destroy();
}

function scheduleTcpReconnect(): void {
	if (shuttingDown || tcpReconnectTimer) return;
	const delay = tcpReconnectDelay;
	console.log(`[tcp] disconnected. Reconnecting in ${delay}ms...`);
	tcpReconnectDelay = Math.min(tcpReconnectDelay * 2, RECONNECT_MAX_MS);
	tcpReconnectTimer = setTimeout(() => {
		tcpReconnectTimer = null;
		connectToChannels();
	}, delay);
}

// --- Health check HTTP server ---

const HEALTH_PORT = Number(process.env.BLOOM_HEALTH_PORT ?? "18801");

const healthServer = createHttpServer((req, res) => {
	if (req.url === "/health") {
		const healthy = waConnected && channelSocket?.writable === true;
		res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ wa: waConnected, channel: channelSocket?.writable === true }));
	} else {
		res.writeHead(404);
		res.end();
	}
});

healthServer.listen(HEALTH_PORT, "0.0.0.0", () => {
	console.log(`[health] listening on :${HEALTH_PORT}`);
});

// --- WhatsApp via Baileys ---

async function startWhatsApp(): Promise<void> {
	if (shuttingDown) return;

	console.log("[wa] starting Baileys client...");

	const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

	const sock = makeWASocket({
		auth: state,
		logger,
	});

	waSock = sock;

	sock.ev.on("creds.update", saveCreds);

	sock.ev.on("connection.update", (update) => {
		const { connection, lastDisconnect, qr } = update;

		if (qr) {
			console.log("[wa] QR code — scan with WhatsApp mobile app (Settings > Linked Devices):");
			qrcode.generate(qr, { small: true });
			// Send QR data to channel bridge for service_pair tool
			sendToChannels({ type: "pairing", channel: "whatsapp", data: qr });
		}

		if (connection === "close") {
			waConnected = false;
			clearTcpReconnectTimer();
			resetChannelSocket();

			const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
			const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

			console.log(`[wa] disconnected (code=${statusCode}). Reconnecting: ${shouldReconnect}`);

			if (shouldReconnect && !shuttingDown) {
				setTimeout(startWhatsApp, 5_000);
			} else if (!shouldReconnect) {
				console.log("[wa] logged out. Remove auth volume and re-pair to reconnect.");
			}
		} else if (connection === "open") {
			console.log("[wa] connected.");
			waConnected = true;
			tcpReconnectDelay = RECONNECT_BASE_MS;
			clearTcpReconnectTimer();
			resetChannelSocket();
			connectToChannels();
		}
	});

	sock.ev.on("messages.upsert", async ({ messages, type }) => {
		if (type !== "notify") return;

		for (const msg of messages) {
			if (msg.key.fromMe) continue;
			if (!msg.message) continue;

			const from = msg.key.remoteJid ?? "";
			const timestamp = msg.messageTimestamp as number;

			const messageType = getContentType(msg.message);

			if (messageType && isMediaType(messageType)) {
				try {
					const mediaMsg = msg.message[messageType];
					if (mediaMsg && typeof mediaMsg === "object" && "url" in mediaMsg) {
						const stream = await downloadContentFromMessage(
							mediaMsg as DownloadableMessage,
							mediaCategory(messageType),
						);
						const chunks: Buffer[] = [];
						for await (const chunk of stream) {
							chunks.push(chunk as Buffer);
						}
						const buffer = Buffer.concat(chunks);
						const mimetype = (mediaMsg as { mimetype?: string }).mimetype ?? "application/octet-stream";
						const caption = (mediaMsg as { caption?: string }).caption;
						await handleMediaMessage(from, timestamp, buffer, mimetype, caption);
						continue;
					}
				} catch (err) {
					console.error("[wa] media download error:", (err as Error).message);
				}
			}

			const text = msg.message.conversation ?? msg.message.extendedTextMessage?.text ?? "";

			if (text) {
				console.log(`[wa] message from ${from}: ${text.slice(0, 80)}`);
				sendToChannels({
					type: "message",
					id: randomUUID(),
					channel: "whatsapp",
					from,
					text,
					timestamp,
				});
			}
		}
	});
}

function isMediaType(type: string): boolean {
	return ["imageMessage", "videoMessage", "audioMessage", "documentMessage", "stickerMessage"].includes(type);
}

function mediaCategory(type: string): MediaType {
	const map: Record<string, MediaType> = {
		imageMessage: "image",
		videoMessage: "video",
		audioMessage: "audio",
		documentMessage: "document",
		stickerMessage: "sticker",
	};
	return map[type] ?? "document";
}

async function handleMediaMessage(
	from: string,
	timestamp: number,
	buffer: Buffer,
	mimetype: string,
	caption?: string,
): Promise<void> {
	const ext = mimeToExt(mimetype);
	const id = randomBytes(6).toString("hex");
	const filename = `${timestamp}-${id}.${ext}`;
	const filepath = `${MEDIA_DIR}/${filename}`;

	await mkdir(MEDIA_DIR, { recursive: true });
	await writeFile(filepath, buffer);
	const size = buffer.length;
	console.log(`[wa] saved media from ${from}: ${filepath} (${size} bytes)`);

	let kind = "unknown";
	if (mimetype.startsWith("audio/")) kind = "audio";
	else if (mimetype.startsWith("image/")) kind = "image";
	else if (mimetype.startsWith("video/")) kind = "video";
	else if (mimetype.startsWith("application/")) kind = "document";

	sendToChannels({
		type: "message",
		id: randomUUID(),
		channel: "whatsapp",
		from,
		timestamp,
		media: {
			kind,
			mimetype,
			filepath,
			size,
			caption: caption || undefined,
		},
	});
}

// --- TCP channel connection ---

function connectToChannels(): void {
	if (shuttingDown || !waConnected) return;
	if (tcpConnecting) return;
	if (channelSocket?.writable) return;

	clearTcpReconnectTimer();
	tcpConnecting = true;
	tcpBuffer = "";

	console.log(`[tcp] connecting to ${CHANNELS_SOCKET}...`);

	const sock = createConnection({ path: CHANNELS_SOCKET });
	channelSocket = sock;
	sock.setEncoding("utf8");

	sock.on("connect", () => {
		if (channelSocket !== sock) return;
		tcpConnecting = false;
		tcpReconnectDelay = RECONNECT_BASE_MS;
		console.log("[tcp] connected to bloom-channels.");

		const registration: Record<string, string> = { type: "register", channel: "whatsapp" };
		if (CHANNEL_TOKEN) registration.token = CHANNEL_TOKEN;
		sock.write(`${JSON.stringify(registration)}\n`);
	});

	sock.on("data", (data: string) => {
		if (channelSocket !== sock) return;

		tcpBuffer += data;
		const lines = tcpBuffer.split("\n");
		tcpBuffer = lines.pop() ?? "";

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			try {
				const msg = JSON.parse(trimmed) as unknown;
				handleChannelMessage(msg);
			} catch (err) {
				console.error("[tcp] parse error:", (err as Error).message, "| raw:", trimmed.slice(0, 120));
			}
		}
	});

	sock.on("error", (err) => {
		if (channelSocket !== sock) return;
		console.error("[tcp] error:", err.message);
	});

	sock.on("close", () => {
		if (channelSocket !== sock) return;
		channelSocket = null;
		tcpConnecting = false;
		if (shuttingDown || !waConnected) return;
		scheduleTcpReconnect();
	});
}

function sendToChannels(msg: Record<string, unknown>): void {
	if (channelSocket?.writable) {
		channelSocket.write(`${JSON.stringify(msg)}\n`);
	} else {
		console.warn("[tcp] channel socket not writable, dropping message:", msg);
	}
}

// --- Incoming channel messages -> WhatsApp ---

function handleChannelMessage(raw: unknown): void {
	if (!isChannelMessage(raw)) {
		console.warn("[tcp] unexpected message shape:", raw);
		return;
	}

	const { type, to, text } = raw;

	if (type === "response" || type === "send") {
		if (!to) {
			console.warn(`[tcp] "${type}" message missing "to" field — dropping.`);
			return;
		}
		if (!text) {
			console.warn(`[tcp] "${type}" message missing "text" field — dropping.`);
			return;
		}
		if (!waSock) {
			console.warn("[tcp] WhatsApp client not ready — dropping message.");
			return;
		}
		console.log(`[wa] sending to ${to}: ${text.slice(0, 80)}`);
		waSock.sendMessage(to, { text }).catch((err: unknown) => {
			console.error("[wa] sendMessage error:", (err as Error).message);
		});
		return;
	}

	if (type === "ping") {
		if (channelSocket?.writable) {
			channelSocket.write(`${JSON.stringify({ type: "pong" })}\n`);
		}
		return;
	}

	if (type === "registered" || type === "pong" || type === "status") {
		return;
	}

	console.warn("[tcp] unhandled message type:", type);
}

// --- Graceful shutdown ---

function shutdown(signal: string): void {
	if (shuttingDown) return;
	shuttingDown = true;
	console.log(`[bloom-whatsapp] received ${signal}, shutting down...`);

	healthServer.close();
	clearTcpReconnectTimer();
	resetChannelSocket();

	if (waSock) {
		waSock.end(undefined);
		waSock = null;
	}

	setTimeout(() => process.exit(0), 1_500);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// --- Entry point ---

startWhatsApp().catch((err: unknown) => {
	console.error("[bloom-whatsapp] fatal startup error:", (err as Error).message);
	process.exit(1);
});
