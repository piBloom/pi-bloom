import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createConnection, type Socket } from "node:net";
import type { Boom } from "@hapi/boom";
import {
	DisconnectReason,
	downloadMediaMessage,
	fetchLatestBaileysVersion,
	makeWASocket,
	useMultiFileAuthState,
} from "baileys";

const AUTH_DIR = process.env.BLOOM_AUTH_DIR ?? "/data/auth";
const CHANNELS_SOCKET = process.env.BLOOM_CHANNELS_SOCKET ?? "/run/bloom/channels.sock";
const MEDIA_DIR = process.env.BLOOM_MEDIA_DIR ?? "/media/bloom";
const CHANNEL_TOKEN = process.env.BLOOM_CHANNEL_TOKEN ?? "";

const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;

const MEDIA_TYPES: Record<string, string> = {
	audioMessage: "audio",
	imageMessage: "image",
	videoMessage: "video",
	documentMessage: "document",
	stickerMessage: "sticker",
};

function mimeToExt(mime: string): string {
	const map: Record<string, string> = {
		"audio/ogg": "ogg",
		"audio/ogg; codecs=opus": "ogg",
		"audio/mpeg": "mp3",
		"audio/mp4": "m4a",
		"audio/wav": "wav",
		"image/jpeg": "jpg",
		"image/png": "png",
		"image/webp": "webp",
		"image/gif": "gif",
		"video/mp4": "mp4",
		"video/3gpp": "3gp",
		"application/pdf": "pdf",
		"application/octet-stream": "bin",
	};
	return map[mime] ?? mime.split("/").pop() ?? "bin";
}

// TCP state
let channelSocket: Socket | null = null;
let tcpBuffer = "";
let tcpReconnectDelay = RECONNECT_BASE_MS;
let shuttingDown = false;
let waConnected = false;

// Track last WhatsApp socket so TCP layer can forward responses
let currentWaSock: ReturnType<typeof makeWASocket> | null = null;

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

// --- WhatsApp ---

async function startWhatsApp(): Promise<void> {
	if (shuttingDown) return;

	console.log("[wa] connecting...");
	const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
	const { version, isLatest } = await fetchLatestBaileysVersion();
	console.log(`[wa] Baileys version ${version.join(".")}${isLatest ? " (latest)" : " (outdated)"}`);

	const sock = makeWASocket({
		version,
		auth: state,
		printQRInTerminal: true,
		// suppress noisy default logger
		logger: makeLogger(),
	});

	currentWaSock = sock;

	sock.ev.on("creds.update", saveCreds);

	sock.ev.on("connection.update", (update) => {
		const { connection, lastDisconnect, qr } = update;

		if (qr) {
			console.log("[wa] Scan the QR code above to pair.");
		}

		if (connection === "open") {
			console.log("[wa] connected.");
			waConnected = true;
			// Reset TCP reconnect delay on fresh WA connection
			tcpReconnectDelay = RECONNECT_BASE_MS;
			connectToChannels(sock);
		}

		if (connection === "close") {
			waConnected = false;
			const statusCode = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
			const reason = statusCode ?? "unknown";
			console.log(`[wa] connection closed (reason: ${reason})`);

			if (statusCode === DisconnectReason.loggedOut) {
				console.log("[wa] logged out — delete auth state and restart to re-pair.");
				return;
			}

			if (!shuttingDown) {
				console.log("[wa] reconnecting in 5s...");
				setTimeout(startWhatsApp, 5_000);
			}
		}
	});

	sock.ev.on("messages.upsert", ({ messages, type }) => {
		if (type !== "notify") return;

		for (const msg of messages) {
			// Skip own messages
			if (msg.key.fromMe) continue;

			const from = msg.key.remoteJid;
			if (!from) continue;

			const timestamp =
				typeof msg.messageTimestamp === "number"
					? msg.messageTimestamp
					: Number(msg.messageTimestamp ?? Math.floor(Date.now() / 1000));

			// Try text extraction first
			const text = msg.message?.conversation ?? msg.message?.extendedTextMessage?.text;

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
				continue;
			}

			// Check for media types
			if (msg.message) {
				const mediaType = Object.keys(msg.message).find((k) => k in MEDIA_TYPES);
				if (mediaType) {
					handleMediaMessage(msg, from, timestamp, mediaType).catch((err) => {
						console.error("[wa] media handling error:", (err as Error).message);
					});
				}
			}
		}
	});
}

async function handleMediaMessage(
	msg: Parameters<typeof downloadMediaMessage>[0],
	from: string,
	timestamp: number,
	mediaType: string,
): Promise<void> {
	const kind = MEDIA_TYPES[mediaType] ?? "unknown";
	const mediaMsg = (msg.message as Record<string, Record<string, unknown>>)?.[mediaType];
	const mimetype = (mediaMsg?.mimetype as string) ?? "application/octet-stream";
	const duration = mediaMsg?.seconds as number | undefined;
	const caption = mediaMsg?.caption as string | undefined;

	let filepath: string;
	let size: number;

	try {
		const buffer = await downloadMediaMessage(msg, "buffer", {});
		const ext = mimeToExt(mimetype);
		const id = randomBytes(6).toString("hex");
		const filename = `${timestamp}-${id}.${ext}`;
		filepath = `${MEDIA_DIR}/${filename}`;

		await mkdir(MEDIA_DIR, { recursive: true });
		await writeFile(filepath, buffer as Buffer);
		size = (buffer as Buffer).length;
		console.log(`[wa] saved ${kind} from ${from}: ${filepath} (${size} bytes)`);
	} catch (err) {
		console.error(`[wa] media download failed:`, (err as Error).message);
		sendToChannels({
			type: "message",
			id: randomUUID(),
			channel: "whatsapp",
			from,
			text: `[${kind} message — download failed]`,
			timestamp,
		});
		return;
	}

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
			duration,
			size,
			caption,
		},
	});
}

// --- Minimal pino-compatible logger to suppress Baileys noise ---

function makeLogger() {
	const noop = () => {};
	return {
		level: "silent",
		trace: noop,
		debug: noop,
		info: noop,
		warn: (obj: unknown, msg?: string) => console.warn("[wa:warn]", msg ?? obj),
		error: (obj: unknown, msg?: string) => console.error("[wa:error]", msg ?? obj),
		fatal: (obj: unknown, msg?: string) => console.error("[wa:fatal]", msg ?? obj),
		child: () => makeLogger(),
	};
}

// --- TCP channel connection ---

function connectToChannels(waSock: ReturnType<typeof makeWASocket>): void {
	if (shuttingDown) return;

	console.log(`[tcp] connecting to ${CHANNELS_SOCKET}...`);

	const sock = createConnection({ path: CHANNELS_SOCKET }, () => {
		console.log("[tcp] connected to bloom-channels.");
		tcpReconnectDelay = RECONNECT_BASE_MS;

		const registration: Record<string, string> = { type: "register", channel: "whatsapp" };
		if (CHANNEL_TOKEN) registration.token = CHANNEL_TOKEN;
		sock.write(`${JSON.stringify(registration)}\n`);
	});

	sock.setEncoding("utf8");

	sock.on("data", (data: string) => {
		tcpBuffer += data;
		const lines = tcpBuffer.split("\n");
		// Keep any incomplete trailing fragment
		tcpBuffer = lines.pop() ?? "";

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			try {
				const msg = JSON.parse(trimmed) as unknown;
				handleChannelMessage(waSock, msg);
			} catch (err) {
				console.error("[tcp] parse error:", (err as Error).message, "| raw:", trimmed.slice(0, 120));
			}
		}
	});

	sock.on("error", (err) => {
		console.error("[tcp] error:", err.message);
	});

	sock.on("close", () => {
		channelSocket = null;
		if (shuttingDown) return;

		console.log(`[tcp] disconnected. Reconnecting in ${tcpReconnectDelay}ms...`);
		const delay = tcpReconnectDelay;
		// Exponential backoff capped at 30s
		tcpReconnectDelay = Math.min(tcpReconnectDelay * 2, RECONNECT_MAX_MS);
		setTimeout(() => connectToChannels(waSock), delay);
	});

	channelSocket = sock;
}

function sendToChannels(msg: Record<string, unknown>): void {
	if (channelSocket?.writable) {
		channelSocket.write(`${JSON.stringify(msg)}\n`);
	} else {
		console.warn("[tcp] channel socket not writable, dropping message:", msg);
	}
}

// --- Incoming channel messages -> WhatsApp ---

interface ChannelMessage {
	type: string;
	to?: string;
	text?: string;
}

function isChannelMessage(val: unknown): val is ChannelMessage {
	return (
		typeof val === "object" &&
		val !== null &&
		"type" in val &&
		typeof (val as Record<string, unknown>).type === "string"
	);
}

function handleChannelMessage(waSock: ReturnType<typeof makeWASocket>, raw: unknown): void {
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
		console.log(`[wa] sending to ${to}: ${text.slice(0, 80)}`);
		waSock.sendMessage(to, { text }).catch((err: unknown) => {
			console.error("[wa] sendMessage error:", (err as Error).message);
		});
		return;
	}

	// Respond to pings from the channel server
	if (type === "ping") {
		if (channelSocket?.writable) {
			channelSocket.write(`${JSON.stringify({ type: "pong" })}\n`);
		}
		return;
	}

	// Acknowledge known control messages silently
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

	if (channelSocket) {
		channelSocket.destroy();
		channelSocket = null;
	}

	if (currentWaSock) {
		currentWaSock.end(undefined);
		currentWaSock = null;
	}

	// Give in-flight ops a moment then exit
	setTimeout(() => process.exit(0), 1_500);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// --- Entry point ---

startWhatsApp().catch((err: unknown) => {
	console.error("[bloom-whatsapp] fatal startup error:", (err as Error).message);
	process.exit(1);
});
