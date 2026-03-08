import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createConnection, type Socket } from "node:net";
import { createInterface } from "node:readline";
import {
	isChannelMessage,
	isJsonRpcResponse,
	isSenderAllowed,
	type JsonRpcResponse,
	mimeToExt,
	parseAllowedSenders,
} from "./utils.js";

// --- Configuration ---

const SIGNAL_CLI = process.env.SIGNAL_CLI_PATH ?? "signal-cli";
const SIGNAL_ACCOUNT = process.env.SIGNAL_ACCOUNT ?? "";
const SIGNAL_CONFIG_DIR = process.env.SIGNAL_CONFIG_DIR ?? "/data/signal";
const defaultSocketPath = `${process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid?.() ?? 1000}`}/bloom/channels.sock`;
const CHANNELS_SOCKET = process.env.BLOOM_CHANNELS_SOCKET ?? defaultSocketPath;
const MEDIA_DIR = process.env.BLOOM_MEDIA_DIR ?? "/media/bloom";
const CHANNEL_TOKEN = process.env.BLOOM_CHANNEL_TOKEN ?? "";
const HEALTH_PORT = Number(process.env.BLOOM_HEALTH_PORT ?? "18802");
const DEVICE_NAME = process.env.BLOOM_DEVICE_NAME ?? "Bloom";

// Sender allowlist: comma-separated phone numbers (E.164). Empty = allow all.
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
let signalConnected = false;
let signalProcess: ChildProcess | null = null;
let linkedAccount = SIGNAL_ACCOUNT; // discovered during link or from env
let pairingInProgress = false;

// JSON-RPC tracking
let jsonRpcId = 1;
const pendingRpcs = new Map<number, { resolve: (val: unknown) => void; reject: (err: Error) => void }>();

// --- Helpers ---

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
		const healthy = signalConnected && channelSocket?.writable === true;
		res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ signal: signalConnected, channel: channelSocket?.writable === true }));
	} else {
		res.writeHead(404);
		res.end();
	}
});

healthServer.listen(HEALTH_PORT, "0.0.0.0", () => {
	console.log(`[health] listening on :${HEALTH_PORT}`);
});

// --- JSON-RPC ---

function sendRpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
	return new Promise((resolve, reject) => {
		if (!signalProcess?.stdin?.writable) {
			reject(new Error("daemon stdin not writable"));
			return;
		}
		const id = jsonRpcId++;
		pendingRpcs.set(id, { resolve, reject });
		const rpc = { jsonrpc: "2.0", method, id, params };
		signalProcess.stdin.write(`${JSON.stringify(rpc)}\n`);
	});
}

function handleRpcResponse(resp: JsonRpcResponse): void {
	const pending = pendingRpcs.get(resp.id);
	if (!pending) {
		console.warn(`[rpc] unexpected response for id=${resp.id}`);
		return;
	}
	pendingRpcs.delete(resp.id);
	if (resp.error) {
		pending.reject(new Error(`${resp.error.message} (code=${resp.error.code})`));
	} else {
		pending.resolve(resp.result);
	}
}

// --- signal-cli daemon ---

interface SignalEnvelope {
	envelope?: {
		source?: string;
		sourceNumber?: string;
		timestamp?: number;
		dataMessage?: {
			message?: string;
			attachments?: Array<{
				contentType?: string;
				filename?: string;
				id?: string;
				size?: number;
			}>;
		};
	};
}

function sendSignalMessage(recipient: string, text: string): void {
	const params: Record<string, unknown> = {
		recipient: [recipient],
		message: text,
	};
	if (linkedAccount) {
		params.account = linkedAccount;
	}
	sendRpc("send", params).catch((err: unknown) => {
		console.error(`[signal] send error: ${(err as Error).message}`);
	});
	console.log(`[signal] sending to ${recipient}: ${text.slice(0, 80)}`);
}

function startSignalDaemon(): void {
	if (shuttingDown) return;

	const args = ["--config", SIGNAL_CONFIG_DIR, "--output=json", "daemon", "--receive-mode=on-connection"];

	console.log("[signal] starting signal-cli daemon (multi-account)...");

	const proc = spawn(SIGNAL_CLI, args, { stdio: ["pipe", "pipe", "pipe"] });

	signalProcess = proc;

	proc.stderr?.on("data", (chunk: Buffer) => {
		const line = chunk.toString().trim();
		if (line) console.error(`[signal-cli] ${line}`);

		if (line.includes("Listening")) {
			signalConnected = true;
			tcpReconnectDelay = RECONNECT_BASE_MS;
			clearTcpReconnectTimer();
			resetChannelSocket();
			connectToChannels();
		}
	});

	if (proc.stdout) {
		const rl = createInterface({ input: proc.stdout });
		rl.on("line", (line: string) => {
			if (!line.trim()) return;
			try {
				const parsed = JSON.parse(line) as unknown;
				if (isJsonRpcResponse(parsed)) {
					handleRpcResponse(parsed);
				} else {
					handleSignalMessage(parsed as SignalEnvelope);
				}
			} catch (err) {
				console.error("[signal] parse error:", (err as Error).message, "| raw:", line.slice(0, 120));
			}
		});
	}

	proc.on("close", (code) => {
		signalConnected = false;
		signalProcess = null;
		// Reject any pending RPCs
		for (const [id, pending] of pendingRpcs) {
			pending.reject(new Error("daemon exited"));
			pendingRpcs.delete(id);
		}
		console.log(`[signal] daemon exited with code ${code}.`);

		if (!shuttingDown) {
			console.log("[signal] restarting daemon in 5s...");
			setTimeout(startSignalDaemon, 5_000);
		}
	});
}

async function handlePairRequest(): Promise<void> {
	if (pairingInProgress) {
		console.warn("[signal] pairing already in progress");
		sendToChannels({ type: "error", channel: "signal", error: "Pairing already in progress" });
		return;
	}
	pairingInProgress = true;
	try {
		console.log("[signal] starting device link...");
		const startResult = (await sendRpc("startLink")) as { deviceLinkUri?: string } | undefined;
		const uri = startResult?.deviceLinkUri;
		if (!uri) {
			throw new Error("startLink did not return deviceLinkUri");
		}
		console.log(`[signal] link URI: ${uri.slice(0, 40)}...`);
		sendToChannels({ type: "pairing", channel: "signal", data: uri });

		console.log("[signal] waiting for phone to confirm link...");
		const finishResult = (await sendRpc("finishLink", { deviceLinkUri: uri, deviceName: DEVICE_NAME })) as
			| { number?: string }
			| undefined;
		const account = finishResult?.number;
		if (account) {
			linkedAccount = account;
			console.log(`[signal] linked as ${account}`);
		} else {
			console.log("[signal] linked (account number not returned)");
		}
		sendToChannels({ type: "paired", channel: "signal", account: linkedAccount });
	} catch (err) {
		console.error(`[signal] pairing failed: ${(err as Error).message}`);
		sendToChannels({ type: "error", channel: "signal", error: (err as Error).message });
	} finally {
		pairingInProgress = false;
	}
}

async function handleSignalMessage(parsed: SignalEnvelope): Promise<void> {
	const env = parsed.envelope;
	if (!env?.dataMessage) return;

	const from = env.sourceNumber ?? env.source ?? "";
	if (!from) return;
	if (!isSenderAllowed(from, ALLOWED_SENDERS)) {
		console.log(`[signal] filtered message from ${from} (not in BLOOM_ALLOWED_SENDERS)`);
		return;
	}

	const timestamp = env.timestamp ?? Math.floor(Date.now() / 1000);
	const text = env.dataMessage.message ?? "";
	const attachments = env.dataMessage.attachments ?? [];

	for (const att of attachments) {
		if (att.id && att.contentType) {
			try {
				const srcPath = `${SIGNAL_CONFIG_DIR}/attachments/${att.id}`;
				const ext = mimeToExt(att.contentType);
				const id = randomBytes(6).toString("hex");
				const filename = `${timestamp}-${id}.${ext}`;
				const filepath = `${MEDIA_DIR}/${filename}`;

				await mkdir(MEDIA_DIR, { recursive: true });
				const buffer = await readFile(srcPath);
				await writeFile(filepath, buffer);

				let kind = "unknown";
				if (att.contentType.startsWith("audio/")) kind = "audio";
				else if (att.contentType.startsWith("image/")) kind = "image";
				else if (att.contentType.startsWith("video/")) kind = "video";
				else if (att.contentType.startsWith("application/")) kind = "document";

				sendToChannels({
					type: "message",
					id: randomUUID(),
					channel: "signal",
					from,
					timestamp,
					media: {
						kind,
						mimetype: att.contentType,
						filepath,
						size: att.size ?? buffer.length,
					},
				});
			} catch (err) {
				console.error("[signal] attachment handling error:", (err as Error).message);
			}
		}
	}

	if (text) {
		console.log(`[signal] message from ${from}: ${text.slice(0, 80)}`);
		sendToChannels({
			type: "message",
			id: randomUUID(),
			channel: "signal",
			from,
			text,
			timestamp,
		});
	}
}

// --- TCP channel connection ---

function connectToChannels(): void {
	if (shuttingDown || !signalConnected) return;
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

		const registration: Record<string, string> = { type: "register", channel: "signal" };
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
		if (shuttingDown || !signalConnected) return;
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

// --- Incoming channel messages -> Signal ---

function handleChannelMessage(raw: unknown): void {
	if (!isChannelMessage(raw)) {
		console.warn("[tcp] unexpected message shape:", raw);
		return;
	}

	const { type, to, text } = raw;

	if (type === "pair") {
		handlePairRequest().catch((err: unknown) => {
			console.error("[signal] pair handler error:", (err as Error).message);
		});
		return;
	}

	if (type === "response" || type === "send") {
		if (!to) {
			console.warn(`[tcp] "${type}" message missing "to" field — dropping.`);
			return;
		}
		if (!text) {
			console.warn(`[tcp] "${type}" message missing "text" field — dropping.`);
			return;
		}
		sendSignalMessage(to, text);
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
	console.log(`[bloom-signal] received ${signal}, shutting down...`);

	healthServer.close();
	clearTcpReconnectTimer();
	resetChannelSocket();

	if (signalProcess) {
		signalProcess.kill("SIGTERM");
		signalProcess = null;
	}

	// Reject pending RPCs
	for (const [id, pending] of pendingRpcs) {
		pending.reject(new Error("shutting down"));
		pendingRpcs.delete(id);
	}

	setTimeout(() => process.exit(0), 3_000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// --- Entry point ---

startSignalDaemon();
