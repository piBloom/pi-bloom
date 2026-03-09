# Matrix Messaging Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace WhatsApp and Signal with self-hosted Continuwuity Matrix server + matrix-bot-sdk bridge as Bloom's core messaging backbone.

**Architecture:** Two new services (bloom-matrix Conduit server + bloom-element bot bridge) replace two existing services (whatsapp + signal). The channel bridge extension gets a `/matrix` command replacing `/wa` and `/signal`. Skills and docs updated throughout.

**Tech Stack:** Continuwuity (Rust Matrix homeserver), matrix-bot-sdk (TypeScript), Node.js 22, Podman Quadlet, Biome

**Design doc:** `docs/plans/2026-03-09-matrix-messaging-design.md`

---

## Task 1: Create bloom-element service — utils and tests (TDD)

**Files:**
- Create: `services/element/src/utils.ts`
- Create: `services/element/tests/utils.test.ts`
- Create: `services/element/vitest.config.ts`
- Create: `services/element/tsconfig.json`
- Create: `services/element/package.json`

**Step 1: Create package.json**

```json
{
  "name": "bloom-element-transport",
  "version": "0.1.0",
  "description": "Matrix bridge for Pi messaging via matrix-bot-sdk",
  "type": "module",
  "main": "dist/transport.js",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "start": "node dist/transport.js"
  },
  "dependencies": {
    "matrix-bot-sdk": "^0.7.1"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@vitest/coverage-v8": "^4.0.18",
    "typescript": "^5.7.0",
    "vitest": "^4.0.18"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src"]
}
```

**Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["tests/**/*.test.ts"],
		environment: "node",
		coverage: {
			provider: "v8",
			include: ["src/utils.ts"],
			thresholds: {
				lines: 80,
				functions: 80,
				branches: 80,
				statements: 80,
			},
		},
	},
});
```

**Step 4: Write the failing tests**

Create `services/element/tests/utils.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { isChannelMessage, isSenderAllowed, mimeToExt, parseAllowedSenders } from "../src/utils.js";

describe("mimeToExt", () => {
	it.each([
		["audio/ogg", "ogg"],
		["audio/ogg; codecs=opus", "ogg"],
		["audio/mpeg", "mp3"],
		["image/jpeg", "jpg"],
		["image/png", "png"],
		["video/mp4", "mp4"],
		["application/pdf", "pdf"],
		["application/octet-stream", "bin"],
	])("maps %s → %s", (mime, ext) => {
		expect(mimeToExt(mime)).toBe(ext);
	});

	it("falls back to subtype for unknown mime", () => {
		expect(mimeToExt("text/plain")).toBe("plain");
	});

	it("returns empty string for empty mime", () => {
		expect(mimeToExt("")).toBe("");
	});
});

describe("isChannelMessage", () => {
	it("returns true for valid object with type string", () => {
		expect(isChannelMessage({ type: "response", to: "@user:bloom", text: "hi" })).toBe(true);
	});

	it("returns true for minimal valid object", () => {
		expect(isChannelMessage({ type: "ping" })).toBe(true);
	});

	it("returns false for null", () => {
		expect(isChannelMessage(null)).toBe(false);
	});

	it("returns false for non-object", () => {
		expect(isChannelMessage("string")).toBe(false);
		expect(isChannelMessage(42)).toBe(false);
	});

	it("returns false for missing type", () => {
		expect(isChannelMessage({ to: "@user:bloom" })).toBe(false);
	});

	it("returns false for non-string type", () => {
		expect(isChannelMessage({ type: 123 })).toBe(false);
	});
});

describe("parseAllowedSenders", () => {
	it("returns empty set for empty string", () => {
		expect(parseAllowedSenders("").size).toBe(0);
	});

	it("parses comma-separated Matrix user IDs", () => {
		const set = parseAllowedSenders("@alice:bloom,@bob:bloom");
		expect(set.size).toBe(2);
		expect(set.has("@alice:bloom")).toBe(true);
		expect(set.has("@bob:bloom")).toBe(true);
	});

	it("trims whitespace", () => {
		const set = parseAllowedSenders(" @alice:bloom , @bob:bloom ");
		expect(set.has("@alice:bloom")).toBe(true);
		expect(set.has("@bob:bloom")).toBe(true);
	});

	it("ignores empty entries from trailing commas", () => {
		const set = parseAllowedSenders("@alice:bloom,,@bob:bloom,");
		expect(set.size).toBe(2);
	});
});

describe("isSenderAllowed", () => {
	it("allows all when allowlist is empty", () => {
		expect(isSenderAllowed("@alice:bloom", new Set())).toBe(true);
	});

	it("allows when sender is in set", () => {
		const allowed = new Set(["@alice:bloom"]);
		expect(isSenderAllowed("@alice:bloom", allowed)).toBe(true);
	});

	it("rejects when not in allowlist", () => {
		const allowed = new Set(["@bob:bloom"]);
		expect(isSenderAllowed("@alice:bloom", allowed)).toBe(false);
	});
});
```

**Step 5: Run tests to verify they fail**

Run: `cd services/element && npm install && npx vitest run`
Expected: FAIL — `src/utils.ts` does not exist

**Step 6: Write utils.ts implementation**

Create `services/element/src/utils.ts`:

```typescript
export interface ChannelMessage {
	type: string;
	to?: string;
	text?: string;
}

const MIME_MAP: Record<string, string> = {
	"audio/ogg": "ogg",
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

export function mimeToExt(mime: string): string {
	const base = mime.split(";")[0].trim();
	return MIME_MAP[base] ?? base.split("/").pop() ?? "";
}

export function isChannelMessage(val: unknown): val is ChannelMessage {
	if (val === null || typeof val !== "object") return false;
	return "type" in val && typeof (val as Record<string, unknown>).type === "string";
}

export function parseAllowedSenders(raw: string): Set<string> {
	if (!raw.trim()) return new Set();
	return new Set(
		raw
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean),
	);
}

export function isSenderAllowed(sender: string, allowedSenders: Set<string>): boolean {
	if (allowedSenders.size === 0) return true;
	return allowedSenders.has(sender);
}
```

**Step 7: Run tests to verify they pass**

Run: `cd services/element && npx vitest run`
Expected: ALL PASS

**Step 8: Commit**

```bash
git add services/element/
git commit -m "feat(element): add bloom-element service skeleton with utils (TDD)"
```

---

## Task 2: Create bloom-element transport (matrix-bot-sdk bridge)

**Files:**
- Create: `services/element/src/transport.ts`

**Step 1: Write the transport**

Create `services/element/src/transport.ts` — this is the main entry point, following the same pattern as `services/whatsapp/src/transport.ts` (single-file entry with health server + channel socket + Matrix client).

```typescript
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createConnection, type Socket } from "node:net";
import {
	AutojoinRoomsMixin,
	MatrixAuth,
	MatrixClient,
	SimpleFsStorageProvider,
} from "matrix-bot-sdk";
import { isChannelMessage, isSenderAllowed, mimeToExt, parseAllowedSenders } from "./utils.js";

// --- Configuration ---

const MATRIX_HOMESERVER = process.env.BLOOM_MATRIX_HOMESERVER ?? "http://bloom-matrix:6167";
const MATRIX_USER = process.env.BLOOM_MATRIX_USER ?? "pi";
const MATRIX_PASSWORD = process.env.BLOOM_MATRIX_PASSWORD ?? "";
const STORAGE_PATH = process.env.BLOOM_STORAGE_PATH ?? "/data/element/bot-state.json";

const defaultSocketPath = `${process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid?.() ?? 1000}`}/bloom/channels.sock`;
const CHANNELS_SOCKET = process.env.BLOOM_CHANNELS_SOCKET ?? defaultSocketPath;
const MEDIA_DIR = process.env.BLOOM_MEDIA_DIR ?? "/media/bloom";
const CHANNEL_TOKEN = process.env.BLOOM_CHANNEL_TOKEN ?? "";

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

// --- Health check HTTP server ---

const HEALTH_PORT = Number(process.env.BLOOM_HEALTH_PORT ?? "18803");

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

// --- TCP helpers (same pattern as whatsapp/signal services) ---

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

// --- Matrix client via matrix-bot-sdk ---

async function startMatrix(): Promise<void> {
	if (shuttingDown) return;
	console.log("[matrix] starting Matrix client...");

	// Login to get access token
	const auth = new MatrixAuth(MATRIX_HOMESERVER);
	const loginClient = await auth.passwordLogin(MATRIX_USER, MATRIX_PASSWORD);
	const accessToken = loginClient.accessToken;
	console.log("[matrix] logged in as", MATRIX_USER);

	// Create persistent client
	const storage = new SimpleFsStorageProvider(STORAGE_PATH);
	const client = new MatrixClient(MATRIX_HOMESERVER, accessToken, storage);
	matrixClient = client;

	// Auto-join rooms when invited
	AutojoinRoomsMixin.setupOnClient(client);

	// Handle incoming messages
	client.on("room.message", async (roomId: string, event: Record<string, unknown>) => {
		const content = event.content as Record<string, unknown> | undefined;
		if (!content?.msgtype) return;

		// Ignore own messages
		const senderId = event.sender as string;
		if (senderId === (await client.getUserId())) return;

		// Sender filtering
		if (!isSenderAllowed(senderId, ALLOWED_SENDERS)) {
			console.log(`[matrix] filtered message from ${senderId} (not in BLOOM_ALLOWED_SENDERS)`);
			return;
		}

		const msgtype = content.msgtype as string;

		// Handle media messages
		if (msgtype === "m.image" || msgtype === "m.audio" || msgtype === "m.video" || msgtype === "m.file") {
			try {
				const url = content.url as string | undefined;
				if (url) {
					const mxcUrl = url; // mxc://server/mediaid
					const httpUrl = client.mxcToHttp(mxcUrl);
					const response = await fetch(httpUrl);
					const buffer = Buffer.from(await response.arrayBuffer());
					const mimetype = (content.info as Record<string, unknown>)?.mimetype as string ?? "application/octet-stream";
					const size = buffer.length;
					const caption = content.body as string | undefined;

					const ext = mimeToExt(mimetype);
					const id = randomBytes(6).toString("hex");
					const timestamp = Math.floor(Date.now() / 1000);
					const filename = `${timestamp}-${id}.${ext}`;
					const filepath = `${MEDIA_DIR}/${filename}`;

					await mkdir(MEDIA_DIR, { recursive: true });
					await writeFile(filepath, buffer);
					console.log(`[matrix] saved media from ${senderId}: ${filepath} (${size} bytes)`);

					let kind = "unknown";
					if (msgtype === "m.audio") kind = "audio";
					else if (msgtype === "m.image") kind = "image";
					else if (msgtype === "m.video") kind = "video";
					else kind = "document";

					sendToChannels({
						type: "message",
						id: randomUUID(),
						channel: "element",
						from: senderId,
						timestamp,
						media: { kind, mimetype, filepath, size, caption: caption || undefined },
					});
					return;
				}
			} catch (err) {
				console.error("[matrix] media download error:", (err as Error).message);
			}
		}

		// Handle text messages
		if (msgtype === "m.text" || msgtype === "m.notice") {
			const text = content.body as string ?? "";
			if (!text) return;

			const timestamp = Math.floor(Date.now() / 1000);
			console.log(`[matrix] message from ${senderId}: ${text.slice(0, 80)}`);
			sendToChannels({
				type: "message",
				id: randomUUID(),
				channel: "element",
				from: senderId,
				text,
				timestamp,
			});
		}
	});

	// Start sync loop
	await client.start();
	console.log("[matrix] connected and syncing.");

	matrixConnected = true;
	tcpReconnectDelay = RECONNECT_BASE_MS;
	clearTcpReconnectTimer();
	resetChannelSocket();
	connectToChannels();
}

// --- Channel socket connection (identical pattern to whatsapp/signal) ---

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
		// "to" is a Matrix room ID (the DM room) — get it from the sender's user ID
		// For "response" messages, "to" is the sender's user ID (@user:bloom)
		// We need to find the DM room with that user
		console.log(`[matrix] sending to ${to}: ${text.slice(0, 80)}`);
		sendMatrixMessage(to, text);
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

async function sendMatrixMessage(userId: string, text: string): Promise<void> {
	if (!matrixClient) return;
	try {
		// Find existing DM room with the user
		const joinedRooms = await matrixClient.getJoinedRooms();
		let dmRoomId: string | null = null;

		for (const roomId of joinedRooms) {
			try {
				const members = await matrixClient.getJoinedRoomMembers(roomId);
				if (members.length === 2 && members.includes(userId)) {
					dmRoomId = roomId;
					break;
				}
			} catch {
				// Skip rooms we can't inspect
			}
		}

		if (!dmRoomId) {
			// Create a new DM room
			dmRoomId = await matrixClient.createRoom({
				invite: [userId],
				is_direct: true,
				preset: "trusted_private_chat",
			});
			console.log(`[matrix] created DM room ${dmRoomId} with ${userId}`);
		}

		await matrixClient.sendText(dmRoomId, text);
	} catch (err) {
		console.error("[matrix] sendMessage error:", (err as Error).message);
	}
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
```

**Step 2: Verify it compiles**

Run: `cd services/element && npx tsc --noEmit`
Expected: No errors

**Step 3: Run tests**

Run: `cd services/element && npx vitest run`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add services/element/src/transport.ts
git commit -m "feat(element): add Matrix transport bridge via matrix-bot-sdk"
```

---

## Task 3: Create bloom-element Containerfile and Quadlet units

**Files:**
- Create: `services/element/Containerfile`
- Create: `services/element/quadlet/bloom-element.container`
- Create: `services/element/quadlet/bloom-element-data.volume`

**Step 1: Create Containerfile**

Follow the exact pattern from `services/_template/Containerfile`:

```dockerfile
FROM docker.io/library/node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY dist/ dist/

ENV NODE_ENV=production
ENV BLOOM_HEALTH_PORT=18803

EXPOSE 18803

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget -qO- http://localhost:18803/health || exit 1

USER node

CMD ["node", "dist/transport.js"]
```

**Step 2: Create Quadlet container unit**

Create `services/element/quadlet/bloom-element.container`:

```ini
[Unit]
Description=Bloom Matrix Bridge (Element)
After=network-online.target bloom-matrix.service
Wants=network-online.target
Requires=bloom-matrix.service

[Container]
Image=localhost/bloom-element:latest
ContainerName=bloom-element
Network=bloom.network
PublishPort=127.0.0.1:18803:18803
Volume=bloom-element-data:/data/element
Volume=/var/lib/bloom/media:/media/bloom
Volume=%t/bloom:/run/bloom

Environment=BLOOM_CHANNELS_SOCKET=/run/bloom/channels.sock
Environment=BLOOM_MATRIX_HOMESERVER=http://bloom-matrix:6167
Environment=BLOOM_MATRIX_USER=pi
Environment=NODE_ENV=production

EnvironmentFile=%h/.config/bloom/channel-tokens/element.env
EnvironmentFile=%h/.config/bloom/element.env

PodmanArgs=--memory=256m
PodmanArgs=--security-opt label=disable
HealthCmd=wget -qO- http://localhost:18803/health || exit 1
HealthInterval=30s
HealthRetries=3
HealthTimeout=10s
HealthStartPeriod=60s
NoNewPrivileges=true
LogDriver=journald

[Service]
Restart=on-failure
RestartSec=10
TimeoutStartSec=300
TimeoutStopSec=30

[Install]
WantedBy=default.target
```

**Step 3: Create volume unit**

Create `services/element/quadlet/bloom-element-data.volume`:

```ini
[Volume]
```

**Step 4: Commit**

```bash
git add services/element/Containerfile services/element/quadlet/
git commit -m "feat(element): add Containerfile and Quadlet units"
```

---

## Task 4: Create bloom-matrix Quadlet units (Continuwuity server)

**Files:**
- Create: `services/matrix/quadlet/bloom-matrix.container`
- Create: `services/matrix/quadlet/bloom-matrix-data.volume`
- Create: `services/matrix/SKILL.md`

**Step 1: Create Quadlet container unit**

Create `services/matrix/quadlet/bloom-matrix.container`:

```ini
[Unit]
Description=Bloom Matrix Homeserver (Continuwuity)
After=network-online.target
Wants=network-online.target

[Container]
Image=forgejo.ellis.link/continuwuation/continuwuity:latest
ContainerName=bloom-matrix
Network=bloom.network
PublishPort=6167:6167
Volume=bloom-matrix-data:/var/lib/continuwuity

Environment=CONTINUWUITY_SERVER_NAME=bloom
Environment=CONTINUWUITY_DATABASE_PATH=/var/lib/continuwuity
Environment=CONTINUWUITY_PORT=6167
Environment=CONTINUWUITY_ALLOW_FEDERATION=false
Environment=CONTINUWUITY_ALLOW_REGISTRATION=true
Environment=CONTINUWUITY_ADDRESS=0.0.0.0
Environment=CONTINUWUITY_MAX_REQUEST_SIZE=20000000
Environment=CONTINUWUITY_ALLOW_CHECK_FOR_UPDATES=false

EnvironmentFile=%h/.config/bloom/matrix.env

PodmanArgs=--memory=256m
HealthCmd=wget -qO- http://localhost:6167/_matrix/client/versions || exit 1
HealthInterval=30s
HealthRetries=3
HealthTimeout=10s
HealthStartPeriod=30s
NoNewPrivileges=true
LogDriver=journald

Exec=--execute "users create_user pi"

[Service]
Restart=on-failure
RestartSec=10
TimeoutStartSec=120
TimeoutStopSec=30

[Install]
WantedBy=default.target
```

**Step 2: Create volume unit**

Create `services/matrix/quadlet/bloom-matrix-data.volume`:

```ini
[Volume]
```

**Step 3: Create SKILL.md**

Create `services/matrix/SKILL.md`:

```markdown
---
name: matrix
version: 0.1.0
description: Continuwuity Matrix homeserver (self-hosted, no federation)
image: forgejo.ellis.link/continuwuation/continuwuity:latest
---

# Matrix Homeserver

Self-hosted Continuwuity Matrix server for private messaging with Pi.

## Overview

Bloom runs its own Matrix homeserver locally. Users register with any Matrix client (Element, FluffyChat, etc.) and message Pi directly. No data leaves the device. No federation — fully private.

## Setup

The Matrix server starts automatically. To register a user account:

1. A registration token is generated during setup: `~/.config/bloom/matrix.env`
2. Open your Matrix client, set homeserver to `http://<bloom-ip>:6167`
3. Register with the token

## Configuration

- Server name: `bloom`
- Port: `6167`
- Registration: token-required (see `~/.config/bloom/matrix.env`)
- Federation: disabled
- Data: persisted in `bloom-matrix-data` volume

## Troubleshooting

- Logs: `journalctl --user -u bloom-matrix -n 100`
- Status: `systemctl --user status bloom-matrix`
- Restart: `systemctl --user restart bloom-matrix`
```

**Step 4: Commit**

```bash
git add services/matrix/
git commit -m "feat(matrix): add Continuwuity homeserver Quadlet units and SKILL.md"
```

---

## Task 5: Create bloom-element SKILL.md

**Files:**
- Create: `services/element/SKILL.md`

**Step 1: Create SKILL.md**

```markdown
---
name: element
version: 0.1.0
description: Matrix bridge for Pi messaging via matrix-bot-sdk
image: localhost/bloom-element:latest
---

# Element Bridge

Bridges Pi to the Matrix network via the local Continuwuity homeserver. Pi appears as `@pi:bloom` and auto-joins rooms when invited.

## Overview

Users message Pi from any Matrix client. The bridge forwards messages to Pi via the bloom-channels Unix socket protocol and returns responses.

## Setup

1. Matrix server must be running: `systemctl --user status bloom-matrix`
2. Install: `service_install(name="element")`
3. Pair: `service_pair(name="element")` — displays registration token + server URL

## Send a message

Use `/matrix` command or message `@pi:bloom` from any Matrix client.

## Media

Incoming media (images, audio, video, files) is downloaded to `/var/lib/bloom/media/` and forwarded to Pi for processing.

## Troubleshooting

- Logs: `journalctl --user -u bloom-element -n 100`
- Status: `systemctl --user status bloom-element`
- Restart: `systemctl --user restart bloom-element`
- If Matrix login fails: check `~/.config/bloom/element.env` has correct `BLOOM_MATRIX_PASSWORD`
```

**Step 2: Commit**

```bash
git add services/element/SKILL.md
git commit -m "feat(element): add SKILL.md documentation"
```

---

## Task 6: Update service catalog

**Files:**
- Modify: `services/catalog.yaml`

**Step 1: Replace whatsapp and signal entries with matrix and element**

In `services/catalog.yaml`, remove lines 22-37 (whatsapp and signal entries) and add:

```yaml
  matrix:
    version: "0.1.0"
    category: communication
    image: forgejo.ellis.link/continuwuation/continuwuity:latest
    optional: false
    preflight:
      commands: [podman, systemctl]
  element:
    version: "0.1.0"
    category: communication
    image: localhost/bloom-element:latest
    optional: false
    depends: [matrix, stt]
    preflight:
      commands: [podman, systemctl]
```

**Step 2: Verify YAML parses**

Run: `node -e "const yaml = require('yaml'); const fs = require('fs'); yaml.parse(fs.readFileSync('services/catalog.yaml','utf8')); console.log('OK')"`

If that fails (no yaml module), use: `python3 -c "import yaml; yaml.safe_load(open('services/catalog.yaml')); print('OK')"`

**Step 3: Commit**

```bash
git add services/catalog.yaml
git commit -m "feat(catalog): replace whatsapp/signal with matrix/element (non-optional)"
```

---

## Task 7: Update bloom-channels extension (replace /wa and /signal with /matrix)

**Files:**
- Modify: `extensions/bloom-channels/index.ts`
- Modify: `extensions/bloom-channels/actions.ts:427-447`

**Step 1: Replace command handlers in actions.ts**

In `extensions/bloom-channels/actions.ts`, replace lines 427-447 (handleWaCommand and handleSignalCommand) with:

```typescript
		handleMatrixCommand(args: string, ctx: ExtensionContext) {
			const matrixChannel = channels.get("element");
			if (!matrixChannel) {
				ctx.ui.notify("Matrix not connected", "warning");
				return;
			}
			const msg = `${JSON.stringify({ type: "send", channel: "element", text: args })}\n`;
			matrixChannel.socket.write(msg);
			ctx.ui.notify("Sent to Matrix", "info");
		},
```

**Step 2: Replace commands in index.ts**

Replace lines 28-40 in `extensions/bloom-channels/index.ts` with:

```typescript
	pi.registerCommand("matrix", {
		description: "Send a message via Matrix",
		handler: async (args, ctx) => {
			bridge.handleMatrixCommand(args, ctx);
		},
	});
```

**Step 3: Update the JSDoc at top of index.ts**

Replace line 4:
```
 * @commands /matrix (send message via Matrix)
```

**Step 4: Run existing tests**

Run: `npm run test -- --run tests/extensions/bloom-channels.test.ts`
Expected: ALL PASS (tests don't cover command handlers directly)

**Step 5: Run lint**

Run: `npm run check`
Expected: No errors

**Step 6: Commit**

```bash
git add extensions/bloom-channels/
git commit -m "feat(channels): replace /wa and /signal commands with /matrix"
```

---

## Task 8: Update bloom-services pairing handler for element

**Files:**
- Modify: `extensions/bloom-services/actions.ts:367-436`

**Step 1: Update handlePair to support element**

In `extensions/bloom-services/actions.ts`, change the pair handler:

1. Update the `name` type on line 369 from `"whatsapp" | "signal"` to `"element"`
2. Remove the signal-specific journal log parsing (lines 404-410)
3. Update the QR instructions (lines 424-427) to say:

```typescript
		const instructions =
			"Your Matrix server is ready! Register with any Matrix client:\n" +
			`Homeserver: http://<your-bloom-ip>:6167\nRegistration token shown below`;
```

**Note:** For element pairing, instead of a QR code of a pairing URI, we display the registration token from `~/.config/bloom/matrix.env`. The pairing flow is different — the user manually enters the homeserver URL in their Matrix client and registers with the token.

Actually, reconsider: the `service_pair` flow should:
1. Read the registration token from `~/.config/bloom/matrix.env`
2. Generate a QR code of the homeserver URL for convenience
3. Display both the URL and the token as text

Update the pair function to handle `"element"` name:

```typescript
export async function handlePair(
	params: {
		name: "element";
		timeout_sec?: number;
	},
	signal: AbortSignal | undefined,
) {
	const serviceName = params.name;
	const unit = "bloom-matrix.service";

	// Check matrix server is installed
	const systemdDir = join(os.homedir(), ".config", "containers", "systemd");
	if (!existsSync(join(systemdDir, "bloom-matrix.container"))) {
		return errorResult("Matrix server is not installed. Run service_install(name=\"matrix\") first.");
	}

	// Read registration token
	const envFile = join(os.homedir(), ".config", "bloom", "matrix.env");
	let registrationToken = "";
	try {
		const content = readFileSync(envFile, "utf-8");
		const match = content.match(/CONTINUWUITY_REGISTRATION_TOKEN=(.+)/);
		if (match) registrationToken = match[1].trim();
	} catch {
		return errorResult(`Cannot read registration token from ${envFile}`);
	}

	if (!registrationToken) {
		return errorResult("No registration token found. Check ~/.config/bloom/matrix.env");
	}

	// Get the machine's IP for the homeserver URL
	const hostname = os.hostname();
	const serverUrl = `http://${hostname}:6167`;

	const instructions = [
		"Connect with any Matrix client (Element, FluffyChat, etc.):",
		"",
		`  Homeserver URL: ${serverUrl}`,
		`  Registration token: ${registrationToken}`,
		"",
		"1. Open your Matrix client",
		"2. Choose 'Create Account' (not login)",
		`3. Set homeserver to: ${serverUrl}`,
		"4. Enter a username and password",
		"5. Enter the registration token when prompted",
		"6. After registering, start a DM with @pi:bloom",
	].join("\n");

	try {
		const qrArt = await QRCode.toString(serverUrl, { type: "terminal", small: true });
		return {
			content: [{ type: "text" as const, text: `${instructions}\n\nScan to open homeserver:\n${qrArt}` }],
			details: { service: serviceName, serverUrl, hasToken: true },
		};
	} catch (err) {
		return {
			content: [{ type: "text" as const, text: instructions }],
			details: { service: serviceName, serverUrl, hasToken: true },
		};
	}
}
```

**Step 2: Run lint**

Run: `npm run check`
Expected: No errors

**Step 3: Commit**

```bash
git add extensions/bloom-services/actions.ts
git commit -m "feat(services): update pairing handler for Matrix/Element"
```

---

## Task 9: Update skills (first-boot, recovery, service-management)

**Files:**
- Modify: `skills/first-boot/SKILL.md:47-54`
- Modify: `skills/recovery/SKILL.md:12-24`
- Modify: `skills/service-management/SKILL.md:109-116,139-148`

**Step 1: Update first-boot channels step**

Replace lines 47-54 in `skills/first-boot/SKILL.md` with:

```markdown
### channels
Matrix is pre-installed. The flow is:
1. `service_pair(name="element")` — shows server URL + registration token
2. Ask user to register with their Matrix client (Element, FluffyChat, etc.)
3. User creates a DM with `@pi:bloom`
4. `service_test(name="element")` — verify it works
```

**Step 2: Update recovery playbook**

Replace lines 12-24 in `skills/recovery/SKILL.md` (WhatsApp Bridge Disconnect section) with:

```markdown
## Matrix Bridge Disconnect

**Symptoms**: Messages not delivered, channel shows disconnected.

1. Check channel status: `system_health`
2. Check Matrix server: `container(action="status")` — look for bloom-matrix
3. Check bridge: `container(action="status")` — look for bloom-element
4. If server not running: `systemd_control service=bloom-matrix action=status`
5. Check logs: `container(action="logs", service="bloom-element", lines=100)`
6. Common causes:
   - Matrix server down → `systemd_control service=bloom-matrix action=restart`
   - Bridge login expired → check `~/.config/bloom/element.env`
   - Channel socket unreachable → verify `$XDG_RUNTIME_DIR/bloom/channels.sock` exists
7. Recovery: `systemd_control service=bloom-element action=restart`
```

**Step 3: Update service-management dependencies table**

Replace lines 109-116 in `skills/service-management/SKILL.md`:

```markdown
| Service | Depends On | Handling |
|---------|-----------|----------|
| `matrix` | None (standalone Matrix homeserver) | — |
| `element` | Pi channels server (`$XDG_RUNTIME_DIR/bloom/channels.sock`), bloom-matrix | Unix socket reconnect with exponential backoff |
| `llm` | None (standalone HTTP API) | — |
| `stt` | None (standalone HTTP API) | — |
| `netbird` | Network stack (NET_ADMIN, /dev/net/tun) | Host network mode |
| `dufs` | Local home bind mount | `%h` bind mount |
```

Replace lines 139-148 (Known Services table):

```markdown
## Known Services

| Name | Version | Category | Description |
|------|---------|----------|-------------|
| `llm` | 0.1.0 | ai | Local LLM via llama.cpp (port 8080) |
| `stt` | 0.1.0 | ai | Speech-to-text via whisper.cpp (port 8081, optional) |
| `matrix` | 0.1.0 | communication | Continuwuity Matrix homeserver (port 6167) |
| `element` | 0.1.0 | communication | Matrix bridge for Pi messaging |
| `netbird` | 0.1.0 | networking | Secure mesh VPN via NetBird |
| `dufs` | 0.1.0 | sync | WebDAV file server via dufs (port 5000) |
```

**Step 4: Commit**

```bash
git add skills/
git commit -m "docs(skills): update first-boot, recovery, service-management for Matrix"
```

---

## Task 10: Update documentation

**Files:**
- Modify: `docs/service-architecture.md` — replace WhatsApp/Signal references with Matrix/Element
- Modify: `docs/channel-protocol.md` — update examples to use "element" channel name

**Step 1: Update service-architecture.md**

Search and replace throughout:
- `bloom-whatsapp` → `bloom-element`
- `bloom-signal` → remove
- `WhatsApp Cloud (Baileys protocol)` → `Continuwuity Matrix (CS API)`
- `Signal Cloud (signal-cli protocol)` → remove
- Add `bloom-matrix` to the diagram as the homeserver component
- Update the media pipeline to reference Matrix media download

**Step 2: Update channel-protocol.md**

Replace all `"whatsapp"` channel references with `"element"` in examples. Remove signal-specific examples.

**Step 3: Run lint**

Run: `npm run check`
Expected: No errors

**Step 4: Commit**

```bash
git add docs/
git commit -m "docs: update architecture and channel protocol for Matrix"
```

---

## Task 11: Delete WhatsApp and Signal services

**Files:**
- Delete: `services/whatsapp/` (entire directory)
- Delete: `services/signal/` (entire directory)

**Step 1: Remove the directories**

```bash
rm -rf services/whatsapp services/signal
```

**Step 2: Verify no remaining references**

Run: `grep -r "whatsapp\|signal" --include="*.ts" --include="*.md" --include="*.yaml" extensions/ lib/ skills/ services/ docs/`

Fix any remaining references found.

**Step 3: Run full test suite**

Run: `npm run test`
Expected: ALL PASS (whatsapp/signal tests are deleted, remaining tests unaffected)

**Step 4: Run build and lint**

Run: `npm run build && npm run check`
Expected: No errors

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove whatsapp and signal services (replaced by Matrix)"
```

---

## Task 12: Final integration verification

**Step 1: Full build**

Run: `npm run build`
Expected: No errors

**Step 2: Full test suite**

Run: `npm run test`
Expected: ALL PASS

**Step 3: Lint check**

Run: `npm run check`
Expected: No errors

**Step 4: Verify element service builds**

Run: `cd services/element && npm install && npm run build && npm run test`
Expected: ALL PASS

**Step 5: Commit any remaining fixes**

If any fixes were needed, commit them:

```bash
git add -A
git commit -m "fix: address integration issues from Matrix migration"
```
