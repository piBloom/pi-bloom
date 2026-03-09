import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createConnection, type Socket } from "node:net";
import { AutojoinRoomsMixin, MatrixAuth, MatrixClient, SimpleFsStorageProvider } from "matrix-bot-sdk";
import { isChannelMessage, isSenderAllowed, mimeToExt, parseAllowedSenders } from "./utils.js";

// --- Configuration ---

const HOMESERVER = process.env.BLOOM_MATRIX_HOMESERVER ?? "http://bloom-matrix:6167";
const MATRIX_USER = process.env.BLOOM_MATRIX_USER ?? "pi";
const MATRIX_PASSWORD = process.env.BLOOM_MATRIX_PASSWORD ?? "";
const STORAGE_PATH = process.env.BLOOM_STORAGE_PATH ?? "/data/element/bot-state.json";
const defaultSocketPath = `${process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid?.() ?? 1000}`}/bloom/channels.sock`;
const CHANNELS_SOCKET = process.env.BLOOM_CHANNELS_SOCKET ?? defaultSocketPath;
const MEDIA_DIR = process.env.BLOOM_MEDIA_DIR ?? "/media/bloom";
const CHANNEL_TOKEN = process.env.BLOOM_CHANNEL_TOKEN ?? "";
const HEALTH_PORT = Number(process.env.BLOOM_HEALTH_PORT ?? "18803");

// Sender allowlist: comma-separated Matrix user IDs. Empty = allow all.
const ALLOWED_SENDERS = parseAllowedSenders(process.env.BLOOM_ALLOWED_SENDERS ?? "");

const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;

// --- State ---

let channelSocket: Socket | null = null;
let tcpBuffer = "";
let tcpReconnectDelay = RECONNECT_BASE_MS;
let tcpReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let tcpConnecting = false;
let shuttingDown = false;
let matrixConnected = false;

let matrixClient: MatrixClient | null = null;
let myUserId = "";

// --- TCP helpers ---

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

const healthServer = createHttpServer((req, res) => {
	if (req.url === "/health") {
		const healthy = matrixConnected && channelSocket?.writable === true;
		res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ matrix: matrixConnected, channel: channelSocket?.writable === true }));
	} else {
		res.writeHead(404);
		res.end();
	}
});

healthServer.listen(HEALTH_PORT, "0.0.0.0", () => {
	console.log(`[health] listening on :${HEALTH_PORT}`);
});

// --- Matrix via matrix-bot-sdk ---

async function startMatrix(): Promise<void> {
	if (shuttingDown) return;

	if (!MATRIX_PASSWORD) {
		console.error("[matrix] BLOOM_MATRIX_PASSWORD is required but not set.");
		process.exit(1);
	}

	console.log(`[matrix] logging in as ${MATRIX_USER} on ${HOMESERVER}...`);

	const auth = new MatrixAuth(HOMESERVER);
	const authClient = await auth.passwordLogin(MATRIX_USER, MATRIX_PASSWORD, "bloom-element");
	const accessToken = authClient.accessToken;

	console.log("[matrix] login successful, creating client with storage...");

	const storage = new SimpleFsStorageProvider(STORAGE_PATH);
	const client = new MatrixClient(HOMESERVER, accessToken, storage);
	matrixClient = client;

	AutojoinRoomsMixin.setupOnClient(client);

	myUserId = await client.getUserId();
	console.log(`[matrix] authenticated as ${myUserId}`);

	// Listen for room messages
	client.on("room.message", async (roomId: string, event: Record<string, unknown>) => {
		if (shuttingDown) return;

		const sender = event.sender as string | undefined;
		if (!sender || sender === myUserId) return;

		const content = event.content as Record<string, unknown> | undefined;
		if (!content) return;

		// Skip redacted/empty events
		if (!content.msgtype) return;

		if (!isSenderAllowed(sender, ALLOWED_SENDERS)) {
			console.log(`[matrix] filtered message from ${sender} (not in BLOOM_ALLOWED_SENDERS)`);
			return;
		}

		const timestamp = (event.origin_server_ts as number) ?? Date.now();
		const msgtype = content.msgtype as string;

		if (msgtype === "m.image" || msgtype === "m.audio" || msgtype === "m.video" || msgtype === "m.file") {
			try {
				await handleMediaMessage(client, sender, timestamp, content);
			} catch (err) {
				console.error("[matrix] media download error:", (err as Error).message);
			}
			return;
		}

		// Text messages (m.text, m.notice, etc.)
		const text = (content.body as string) ?? "";
		if (text) {
			console.log(`[matrix] message from ${sender}: ${text.slice(0, 80)}`);
			sendToChannels({
				type: "message",
				id: randomUUID(),
				channel: "element",
				from: sender,
				text,
				timestamp,
			});
		}
	});

	await client.start();
	matrixConnected = true;
	console.log("[matrix] client started and syncing.");

	tcpReconnectDelay = RECONNECT_BASE_MS;
	clearTcpReconnectTimer();
	resetChannelSocket();
	connectToChannels();
}

// --- Media handling ---

async function handleMediaMessage(
	client: MatrixClient,
	from: string,
	timestamp: number,
	content: Record<string, unknown>,
): Promise<void> {
	const mxcUrl = content.url as string | undefined;
	if (!mxcUrl) return;

	const { data: buffer, contentType } = await client.downloadContent(mxcUrl);
	const mimetype = ((content.info as Record<string, unknown>)?.mimetype as string | undefined) ?? contentType;
	const caption = content.body as string | undefined;

	const ext = mimeToExt(mimetype);
	const id = randomBytes(6).toString("hex");
	const filename = `${timestamp}-${id}.${ext}`;
	const filepath = `${MEDIA_DIR}/${filename}`;

	await mkdir(MEDIA_DIR, { recursive: true });
	await writeFile(filepath, buffer);
	const size = buffer.length;
	console.log(`[matrix] saved media from ${from}: ${filepath} (${size} bytes)`);

	let kind = "unknown";
	if (mimetype.startsWith("audio/")) kind = "audio";
	else if (mimetype.startsWith("image/")) kind = "image";
	else if (mimetype.startsWith("video/")) kind = "video";
	else if (mimetype.startsWith("application/")) kind = "document";

	sendToChannels({
		type: "message",
		id: randomUUID(),
		channel: "element",
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

// --- Sending messages to Matrix ---

async function findOrCreateDmRoom(client: MatrixClient, userId: string): Promise<string> {
	const joinedRooms = await client.getJoinedRooms();

	for (const roomId of joinedRooms) {
		try {
			const members = await client.getJoinedRoomMembers(roomId);
			if (members.length === 2 && members.includes(userId)) {
				return roomId;
			}
		} catch {
			// Skip rooms we can't inspect
		}
	}

	console.log(`[matrix] creating DM room with ${userId}`);
	const roomId = await client.createRoom({
		invite: [userId],
		is_direct: true,
		preset: "trusted_private_chat",
	});
	return roomId;
}

// --- TCP channel connection ---

function connectToChannels(): void {
	if (shuttingDown || !matrixConnected) return;
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

		const registration: Record<string, string> = { type: "register", channel: "element" };
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
		if (shuttingDown || !matrixConnected) return;
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

// --- Incoming channel messages -> Matrix ---

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
		if (!matrixClient) {
			console.warn("[tcp] Matrix client not ready — dropping message.");
			return;
		}
		console.log(`[matrix] sending to ${to}: ${text.slice(0, 80)}`);
		const client = matrixClient;
		findOrCreateDmRoom(client, to)
			.then((roomId) => client.sendText(roomId, text))
			.catch((err: unknown) => {
				console.error("[matrix] sendText error:", (err as Error).message);
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
	console.log(`[bloom-element] received ${signal}, shutting down...`);

	healthServer.close();
	clearTcpReconnectTimer();
	resetChannelSocket();

	if (matrixClient) {
		matrixClient.stop();
		matrixClient = null;
	}

	setTimeout(() => process.exit(0), 1_500);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// --- Entry point ---

startMatrix().catch((err: unknown) => {
	console.error("[bloom-element] fatal startup error:", (err as Error).message);
	process.exit(1);
});
