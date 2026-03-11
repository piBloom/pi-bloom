# Matrix Core OS Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote Matrix (Continuwuity), Cinny, and the Pi-Matrix bot from containerized services to native OS infrastructure. Retire the Unix socket channel architecture. Matrix rooms become the universal communication layer.

**Architecture:** Continuwuity binary extracted from its container image into the bootc image. Pi connects to Matrix directly via `matrix-bot-sdk` in-process. Cinny served as static files by nginx. External bridges (WhatsApp, Telegram, Signal) remain Podman containers managed by Pi. The Unix socket channel bridge is fully removed.

**Tech Stack:** Continuwuity (Rust Matrix homeserver), matrix-bot-sdk (Node.js), Cinny (static React app), nginx, systemd, Podman Quadlet, TypeScript, vitest

**Spec:** `docs/superpowers/specs/2026-03-11-matrix-core-os-infrastructure-design.md`

---

## Chunk 1: OS Image — Bake Continuwuity, Cinny, and systemd units

### Task 1: Add Continuwuity binary and systemd unit to OS image

**Files:**
- Modify: `os/Containerfile`
- Create: `os/sysconfig/bloom-matrix.service`
- Create: `os/sysconfig/bloom-matrix.toml`

- [ ] **Step 1: Create Continuwuity systemd unit file**

```ini
# os/sysconfig/bloom-matrix.service
[Unit]
Description=Bloom Matrix Homeserver (Continuwuity)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/continuwuity
Environment=CONTINUWUITY_CONFIG=/etc/bloom/matrix.toml
ExecReload=/bin/kill -HUP $MAINPID
Restart=on-failure
RestartSec=5
DynamicUser=yes
StateDirectory=continuwuity
RuntimeDirectory=continuwuity

[Install]
WantedBy=multi-user.target
```

Note: `DynamicUser=yes` creates a transient user for the process, and `StateDirectory=continuwuity` auto-creates `/var/lib/continuwuity/` with correct ownership. `ExecReload` sends SIGHUP to reload config (used for appservice registration).

- [ ] **Step 2: Create Continuwuity config file**

```toml
# os/sysconfig/bloom-matrix.toml
[global]
server_name = "bloom"
database_path = "/var/lib/continuwuity"
port = [6167]
address = "0.0.0.0"
allow_federation = false
allow_registration = true
registration_token_file = "/var/lib/continuwuity/registration_token"
max_request_size = 20000000
allow_check_for_updates = false
```

Note: The `registration_token_file` path is under `/var/lib/continuwuity/` which is the StateDirectory. The actual token will be generated at first boot by Pi's setup flow and written to this path.

- [ ] **Step 3: Create appservices directory in tmpfiles config**

Modify `os/sysconfig/bloom-tmpfiles.conf` to add:

```
d /etc/bloom 0755 root root -
d /etc/bloom/appservices 0755 root root -
```

- [ ] **Step 4: Add sudoers entry for Continuwuity reload**

Modify `os/sysconfig/bloom-sudoers` to add:

```
# Allow pi user to reload Matrix homeserver (for appservice registration)
pi ALL=(ALL) NOPASSWD: /usr/bin/systemctl reload bloom-matrix
pi ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart bloom-matrix
```

Note: Keep the existing `%wheel ALL=(ALL) NOPASSWD:ALL` line. The pi-specific entry is a safeguard for when the user isn't in the wheel group.

- [ ] **Step 5: Update Containerfile to extract Continuwuity binary**

Add these lines to `os/Containerfile` after the NetBird section (after line 56):

```dockerfile
# ── Continuwuity Matrix homeserver (native binary) ──────────────────────
FROM forgejo.ellis.link/continuwuation/continuwuity:0.5.0-rc.6 AS continuwuity-src

FROM <base> # this continues the main build stage
COPY --from=continuwuity-src /usr/local/bin/continuwuity /usr/local/bin/continuwuity
COPY os/sysconfig/bloom-matrix.toml /etc/bloom/matrix.toml
COPY os/sysconfig/bloom-matrix.service /etc/systemd/system/bloom-matrix.service
RUN systemctl enable bloom-matrix
```

Important: The Containerfile uses a single `FROM` for bootc. Multi-stage with bootc requires careful handling — the `continuwuity-src` stage is declared at the top, and the binary is `COPY --from`'d into the main stage. Check the exact binary path inside the Continuwuity container image first by inspecting it.

- [ ] **Step 6: Verify Continuwuity binary path in source image**

Run: `podman run --rm forgejo.ellis.link/continuwuation/continuwuity:0.5.0-rc.6 which continuwuity || podman run --rm forgejo.ellis.link/continuwuation/continuwuity:0.5.0-rc.6 ls /usr/local/bin/`

Adjust the `COPY --from` path if the binary is at a different location.

- [ ] **Step 7: Commit**

```bash
git add os/sysconfig/bloom-matrix.service os/sysconfig/bloom-matrix.toml os/Containerfile os/sysconfig/bloom-tmpfiles.conf os/sysconfig/bloom-sudoers
git commit -m "feat: bake Continuwuity Matrix homeserver into OS image as native service"
```

---

### Task 2: Add Cinny web client and update nginx config

**Files:**
- Modify: `os/Containerfile`
- Modify: `os/sysconfig/bloom-nginx.conf`
- Create: `os/sysconfig/cinny-config.json`

- [ ] **Step 1: Create Cinny config.json**

```json
{
  "defaultHomeserver": 0,
  "homeserverList": [
    {
      "name": "Bloom",
      "address": "/"
    }
  ],
  "allowCustomHomeservers": false
}
```

The `"address": "/"` tells Cinny to use the same origin — nginx will proxy `/_matrix/` to Continuwuity. This works regardless of hostname/IP.

- [ ] **Step 2: Update nginx config to serve Cinny and proxy Matrix API**

Replace the full content of `os/sysconfig/bloom-nginx.conf`:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

# Default server — status page
server {
    listen 80 default_server;
    server_name _;

    # Cinny web client
    location /cinny {
        alias /usr/share/cinny;
        try_files $uri $uri/ /cinny/index.html;
    }

    # Matrix client-server API proxy
    location /_matrix/ {
        proxy_pass http://127.0.0.1:6167;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        client_max_body_size 20m;
    }

    location / {
        root /usr/share/nginx/html;
        index bloom-status.html;
    }
}

# dufs WebDAV file server
server {
    listen 80;
    server_name files.pibloom.netbird.cloud;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        client_max_body_size 0;
    }
}
```

- [ ] **Step 3: Update Containerfile to download and install Cinny**

Add after the Continuwuity section:

```dockerfile
# ── Cinny web client (static files) ─────────────────────────────────────
ARG CINNY_VERSION=4.3.0
RUN curl -fsSL "https://github.com/cinnyapp/cinny/releases/download/v${CINNY_VERSION}/cinny-v${CINNY_VERSION}.tar.gz" \
    | tar -xz -C /usr/share/ && mv /usr/share/cinny-v${CINNY_VERSION} /usr/share/cinny
COPY os/sysconfig/cinny-config.json /usr/share/cinny/config.json
```

Note: Check the actual tarball structure from the Cinny GitHub releases to confirm the extracted directory name.

- [ ] **Step 4: Commit**

```bash
git add os/sysconfig/cinny-config.json os/sysconfig/bloom-nginx.conf os/Containerfile
git commit -m "feat: bake Cinny web client into OS image, proxy Matrix API via nginx"
```

---

### Task 3: Remove containerized Matrix and Element from OS image

**Files:**
- Modify: `os/Containerfile` (remove any Quadlet COPY lines for matrix/element if present)
- Verify: no Quadlet files for matrix/element are copied into the image

- [ ] **Step 1: Check if Containerfile copies any matrix/element Quadlet files**

Run: `grep -n "matrix\|element" os/Containerfile`

If any lines copy `bloom-matrix.container` or `bloom-element.container` into the image, remove them.

- [ ] **Step 2: Commit (if changes made)**

```bash
git add os/Containerfile
git commit -m "chore: remove containerized matrix/element Quadlet copies from OS image"
```

---

## Chunk 2: lib/matrix.ts — Pure Matrix utility functions

### Task 4: Migrate extractResponseText to lib/ and create lib/matrix.ts

**Files:**
- Create: `lib/matrix.ts`
- Create: `tests/lib/matrix.test.ts`

- [ ] **Step 1: Write tests for extractResponseText (migrated) and new Matrix utilities**

```typescript
// tests/lib/matrix.test.ts
import { describe, expect, it } from "vitest";
import { extractResponseText, generatePassword, matrixCredentialsPath } from "../../lib/matrix.js";

describe("extractResponseText", () => {
	it("extracts string content (post-compaction)", () => {
		const messages = [{ role: "assistant", content: "summarized text" }];
		expect(extractResponseText(messages)).toBe("summarized text");
	});

	it("extracts text blocks from array content", () => {
		const messages = [
			{ role: "assistant", content: [{ type: "text", text: "hello" }] },
		];
		expect(extractResponseText(messages)).toBe("hello");
	});

	it("skips tool_use blocks", () => {
		const messages = [
			{
				role: "assistant",
				content: [
					{ type: "tool_use", id: "1", name: "foo" },
					{ type: "text", text: "actual response" },
				],
			},
		];
		expect(extractResponseText(messages)).toBe("actual response");
	});

	it("concatenates multiple text parts", () => {
		const messages = [
			{
				role: "assistant",
				content: [
					{ type: "text", text: "part1" },
					{ type: "text", text: "part2" },
				],
			},
		];
		expect(extractResponseText(messages)).toBe("part1\n\npart2");
	});

	it("returns empty string for no assistant messages", () => {
		expect(extractResponseText([{ role: "user", content: "hello" }])).toBe("");
	});

	it("returns empty string for tool-only turns", () => {
		const messages = [
			{ role: "assistant", content: [{ type: "tool_use", id: "1", name: "foo" }] },
		];
		expect(extractResponseText(messages)).toBe("");
	});

	it("returns last assistant message text", () => {
		const messages = [
			{ role: "assistant", content: "first" },
			{ role: "user", content: "question" },
			{ role: "assistant", content: "second" },
		];
		expect(extractResponseText(messages)).toBe("second");
	});

	it("returns empty string for empty array", () => {
		expect(extractResponseText([])).toBe("");
	});
});

describe("generatePassword", () => {
	it("returns a base64url string of expected length", () => {
		const pw = generatePassword();
		expect(pw.length).toBeGreaterThan(16);
		expect(pw).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	it("generates unique passwords", () => {
		const a = generatePassword();
		const b = generatePassword();
		expect(a).not.toBe(b);
	});
});

describe("matrixCredentialsPath", () => {
	it("returns path under .pi directory", () => {
		const p = matrixCredentialsPath();
		expect(p).toContain(".pi");
		expect(p).toContain("matrix-credentials.json");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/lib/matrix.test.ts`
Expected: FAIL — module `lib/matrix.js` does not exist.

- [ ] **Step 3: Implement lib/matrix.ts**

Note: `lib/matrix.ts` contains ONLY pure functions — no I/O, no `fetch()`. The `registerMatrixAccount` function (which performs network I/O) stays in the extension layer (`extensions/bloom-channels/matrix-client.ts`), consistent with ARCHITECTURE.md rules for lib/.

```typescript
// lib/matrix.ts
/**
 * Pure Matrix utility functions.
 * No side effects — all I/O is handled by callers.
 */
import { randomBytes } from "node:crypto";
import os from "node:os";
import { join } from "node:path";

/** Path to stored Matrix credentials. */
export function matrixCredentialsPath(): string {
	return join(os.homedir(), ".pi", "matrix-credentials.json");
}

/** Generate a secure random password (base64url, 24 bytes = 32 chars). */
export function generatePassword(bytes = 24): string {
	return randomBytes(bytes).toString("base64url");
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

		if (typeof content === "string") return content;

		if (Array.isArray(content)) {
			const textParts = (content as Array<{ type: string; text?: string }>)
				.filter((c) => c.type === "text" && c.text)
				.map((c) => c.text as string);
			if (textParts.length > 0) return textParts.join("\n\n");
		}
	}
	return "";
}

/** Matrix credentials structure stored on disk. */
export interface MatrixCredentials {
	homeserver: string;
	botUserId: string;
	botAccessToken: string;
	botPassword: string;
	userUserId?: string;
	userPassword?: string;
	registrationToken: string;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/lib/matrix.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/matrix.ts tests/lib/matrix.test.ts
git commit -m "feat: add lib/matrix.ts with extractResponseText, registration, and credential helpers"
```

---

## Chunk 3: Rewrite bloom-channels — Socket server to Matrix client

### Task 5: Rewrite bloom-channels extension as Matrix client

**Files:**
- Rewrite: `extensions/bloom-channels/index.ts`
- Rewrite: `extensions/bloom-channels/actions.ts`
- Delete: `extensions/bloom-channels/channel-server.ts`
- Delete: `extensions/bloom-channels/pairing.ts`
- Rewrite: `extensions/bloom-channels/types.ts`
- Create: `extensions/bloom-channels/matrix-client.ts`
- Rewrite: `tests/extensions/bloom-channels.test.ts`

- [ ] **Step 0: Install matrix-bot-sdk dependency first**

Run: `npm install matrix-bot-sdk@^0.7.1`

This must happen before writing any code that imports from `matrix-bot-sdk`.

- [ ] **Step 1: Write tests for the new Matrix client module**

The old `bloom-channels.test.ts` tested `extractResponseText` and pairing state — both are now gone from this extension. The `extractResponseText` tests live in `tests/lib/matrix.test.ts` (Task 4). Pairing state is deleted entirely. Delete `tests/extensions/bloom-channels.test.ts` — it has no remaining test subjects.

```bash
rm tests/extensions/bloom-channels.test.ts
```

Note: The full Matrix client integration (connecting to Continuwuity, syncing messages) cannot be unit-tested without a running homeserver. Integration testing happens via `just vm` and manual verification.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/extensions/bloom-channels.test.ts`
Expected: FAIL (old imports broken after rewrite, or tests reference removed code).

- [ ] **Step 3: Create new types.ts**

```typescript
// extensions/bloom-channels/types.ts
/**
 * Types for the Matrix-based channel bridge.
 */

/** Stored connection state for the Matrix client. */
export interface MatrixConnectionState {
	connected: boolean;
	userId: string | null;
	homeserver: string;
	roomId: string | null;
}

/** Inbound message from a Matrix room. */
export interface MatrixInboundMessage {
	roomId: string;
	senderId: string;
	body: string;
	eventId: string;
	timestamp: number;
	media?: MatrixMediaInfo;
}

/** Media attachment from Matrix. */
export interface MatrixMediaInfo {
	kind: "image" | "audio" | "video" | "document";
	mimetype: string;
	url: string;
	filename: string;
	size: number;
}
```

- [ ] **Step 4: Create matrix-client.ts — the core Matrix connection logic**

```typescript
// extensions/bloom-channels/matrix-client.ts
/**
 * Matrix client bridge for Pi.
 * Connects directly to the local Continuwuity homeserver via matrix-bot-sdk.
 * Replaces the previous Unix socket channel bridge.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import os from "node:os";
import {
	AutojoinRoomsMixin,
	MatrixClient,
	SimpleFsStorageProvider,
} from "matrix-bot-sdk";
import type {
	AgentEndEvent,
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { createLogger } from "../../lib/shared.js";
import {
	extractResponseText,
	matrixCredentialsPath,
	type MatrixCredentials,
} from "../../lib/matrix.js";

const log = createLogger("bloom-channels");

const HOMESERVER_URL = process.env.BLOOM_MATRIX_HOMESERVER ?? "http://localhost:6167";
const STORAGE_PATH = join(os.homedir(), ".pi", "matrix-bot-state.json");

/** Pending message context — tracks which room to respond to. */
interface PendingContext {
	roomId: string;
	sender: string;
	createdAt: number;
}

/** Load stored Matrix credentials from disk. */
function loadCredentials(): MatrixCredentials | null {
	const path = matrixCredentialsPath();
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as MatrixCredentials;
	} catch {
		return null;
	}
}

/**
 * Register a Matrix account via the Client-Server API with UIA flow.
 * This is I/O (fetch) so it lives here in the extension layer, not in lib/.
 */
export async function registerMatrixAccount(
	homeserver: string,
	username: string,
	password: string,
	registrationToken: string,
): Promise<{ ok: true; userId: string; accessToken: string } | { ok: false; error: string }> {
	const url = `${homeserver}/_matrix/client/v3/register`;
	const body = { username, password, auth: {}, inhibit_login: false };

	const step1 = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});

	if (step1.ok) {
		const data = (await step1.json()) as { user_id: string; access_token: string };
		return { ok: true, userId: data.user_id, accessToken: data.access_token };
	}

	if (step1.status !== 401) {
		const err = (await step1.json()) as { errcode?: string; error?: string };
		if (err.errcode === "M_USER_IN_USE") return { ok: false, error: `Username "${username}" is already taken.` };
		return { ok: false, error: err.error ?? `Registration failed (${step1.status})` };
	}

	const step1Body = (await step1.json()) as { session?: string };
	const session = step1Body.session;
	if (!session) return { ok: false, error: "No session ID in 401 response" };

	const step2Body = {
		username,
		password,
		inhibit_login: false,
		auth: { type: "m.login.registration_token", token: registrationToken, session },
	};

	const step2 = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(step2Body),
	});

	if (step2.ok) {
		const data = (await step2.json()) as { user_id: string; access_token: string };
		return { ok: true, userId: data.user_id, accessToken: data.access_token };
	}

	const err2 = (await step2.json()) as { errcode?: string; error?: string };
	if (step2.status === 401) return { ok: false, error: "Invalid registration token" };
	if (err2.errcode === "M_USER_IN_USE") return { ok: false, error: `Username "${username}" is already taken.` };
	return { ok: false, error: err2.error ?? `Registration step 2 failed (${step2.status})` };
}

/**
 * Create the Matrix channel bridge.
 * Returns hook handlers that Pi calls on session lifecycle events.
 */
export function createMatrixBridge(pi: ExtensionAPI) {
	let client: MatrixClient | null = null;
	let activeRoomId: string | null = null;

	// Pending context map: message UUID → room context
	// Supports messages from multiple rooms concurrently
	const pendingContexts = new Map<string, PendingContext>();

	function updateWidget(ctx: ExtensionContext | null, connected: boolean) {
		if (!ctx) return;
		try {
			ctx.ui?.setStatus?.(connected ? "Matrix: connected" : "Matrix: disconnected");
		} catch {
			// widget may not be available
		}
	}

	async function handleSessionStart(
		_event: unknown,
		ctx: ExtensionContext,
	): Promise<void> {
		const creds = loadCredentials();
		if (!creds) {
			log.info("no Matrix credentials found, skipping Matrix connection");
			updateWidget(ctx, false);
			return;
		}

		try {
			const storageDir = dirname(STORAGE_PATH);
			if (!existsSync(storageDir)) mkdirSync(storageDir, { recursive: true });

			const storage = new SimpleFsStorageProvider(STORAGE_PATH);
			client = new MatrixClient(
				HOMESERVER_URL,
				creds.botAccessToken,
				storage,
			);
			AutojoinRoomsMixin.setupOnClient(client);

			client.on("room.message", async (roomId: string, event: Record<string, unknown>) => {
				if (!event || typeof event !== "object") return;
				const sender = event.sender as string;
				if (sender === creds.botUserId) return; // ignore own messages

				const content = event.content as Record<string, unknown> | undefined;
				if (!content) return;

				const msgtype = content.msgtype as string;
				const body = content.body as string;

				if (msgtype === "m.text" && body) {
					activeRoomId = roomId;

					// Generate unique message ID for response correlation
					const msgId = randomUUID();
					pendingContexts.set(msgId, {
						roomId,
						sender,
						createdAt: Date.now(),
					});

					// Deliver message to Pi as a follow-up user prompt
					// Append msgId so handleAgentEnd can correlate the response
					const prompt = `[Matrix from ${sender}] ${body} [msgId:${msgId}]`;
					try {
						pi.sendUserMessage(prompt);
						log.info(`delivered message from ${sender} in ${roomId}`);
					} catch (err) {
						log.error("failed to deliver Matrix message to Pi", { err });
						pendingContexts.delete(msgId);
					}
				}
			});

			await client.start();
			log.info("Matrix client connected", { userId: creds.botUserId });
			updateWidget(ctx, true);
		} catch (err) {
			log.error("failed to start Matrix client", { err });
			updateWidget(ctx, false);
		}
	}

	async function handleAgentEnd(
		event: AgentEndEvent,
		_ctx: ExtensionContext,
	): Promise<void> {
		if (!client || pendingContexts.size === 0) return;

		const responseText = extractResponseText(event.messages);
		if (!responseText) return;

		// Find the msgId in the conversation to correlate response → room
		const msgIdMatch = responseText.match(/\[msgId:([^\]]+)\]/) ??
			JSON.stringify(event.messages).match(/\[msgId:([^\]]+)\]/);

		let targetRoomId: string | null = null;

		if (msgIdMatch) {
			const ctx = pendingContexts.get(msgIdMatch[1]);
			if (ctx) {
				targetRoomId = ctx.roomId;
				pendingContexts.delete(msgIdMatch[1]);
			}
		}

		// Fallback: use the most recent pending context
		if (!targetRoomId && pendingContexts.size > 0) {
			const entries = [...pendingContexts.entries()];
			const latest = entries[entries.length - 1];
			targetRoomId = latest[1].roomId;
			pendingContexts.delete(latest[0]);
		}

		if (!targetRoomId) return;

		// Strip msgId tags from response before sending to Matrix
		const cleanResponse = responseText.replace(/\s*\[msgId:[^\]]+\]/g, "");
		if (!cleanResponse.trim()) return;

		try {
			await client.sendText(targetRoomId, cleanResponse);
			log.info(`sent response to room ${targetRoomId}`);
		} catch (err) {
			log.error("failed to send response to Matrix", { err });
		}
	}

	async function handleSessionShutdown(): Promise<void> {
		if (client) {
			try {
				client.stop();
			} catch {
				// best-effort cleanup
			}
			client = null;
		}
		activeRoomId = null;
		pendingContexts.clear();
		log.info("Matrix client stopped");
	}

	async function handleMatrixCommand(
		args: string,
		_ctx: ExtensionContext,
	): Promise<void> {
		if (!client || !activeRoomId) {
			log.warn("cannot send Matrix message: not connected or no active room");
			return;
		}
		if (args.trim()) {
			await client.sendText(activeRoomId, args.trim());
		}
	}

	return {
		handleSessionStart,
		handleAgentEnd,
		handleSessionShutdown,
		handleMatrixCommand,
	};
}
```

Note: The `pi.sendUserMessage(prompt)` call delivers the Matrix message to Pi as a follow-up user prompt. The exact API may need adjustment based on the Pi SDK version — check the `ExtensionAPI` type for the correct method name. The `[msgId:UUID]` tag in the prompt enables correlating responses back to the correct Matrix room, following the same pattern used by the previous socket bridge.

- [ ] **Step 5: Rewrite actions.ts to re-export from matrix-client**

```typescript
// extensions/bloom-channels/actions.ts
/**
 * Handler / business logic for bloom-channels.
 */
export { createMatrixBridge, registerMatrixAccount } from "./matrix-client.js";
```

- [ ] **Step 6: Rewrite index.ts**

```typescript
// extensions/bloom-channels/index.ts
/**
 * bloom-channels — Matrix client bridge for Pi messaging.
 *
 * Connects directly to the local Continuwuity homeserver via matrix-bot-sdk.
 * Pi logs in as @pi:bloom and listens for messages in Matrix rooms.
 *
 * @commands /matrix (send message via Matrix)
 * @hooks session_start, agent_end, session_shutdown
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createMatrixBridge } from "./actions.js";

export { registerMatrixAccount } from "./actions.js";

export default function (pi: ExtensionAPI) {
	const bridge = createMatrixBridge(pi);

	pi.on("session_start", (event, ctx) => {
		bridge.handleSessionStart(event, ctx);
	});

	pi.on("agent_end", (event, ctx) => {
		bridge.handleAgentEnd(event, ctx);
	});

	pi.on("session_shutdown", (event, ctx) => {
		bridge.handleSessionShutdown(event, ctx);
	});

	pi.registerCommand("matrix", {
		description: "Send a message via Matrix",
		handler: async (args, ctx) => {
			bridge.handleMatrixCommand(args, ctx);
		},
	});
}
```

- [ ] **Step 7: Delete old files**

```bash
rm extensions/bloom-channels/channel-server.ts
rm extensions/bloom-channels/pairing.ts
```

- [ ] **Step 8: Run tests**

Run: `npm run test -- tests/extensions/bloom-channels.test.ts`
Expected: PASS

- [ ] **Step 9: Run full test suite to check for broken imports**

Run: `npm run test`
Expected: Check for any imports of the deleted files or removed exports (like `getPairingData`, `setPairingData`, `clearPairingData`).

- [ ] **Step 10: Run biome check**

Run: `npm run check`
Expected: PASS (or fix any formatting issues with `npm run check:fix`)

- [ ] **Step 11: Commit**

```bash
git add extensions/bloom-channels/ lib/matrix.ts tests/extensions/bloom-channels.test.ts package.json package-lock.json
git commit -m "feat: rewrite bloom-channels from Unix socket to direct Matrix client"
```

---

## Chunk 4: Update bloom-services — Remove Element, add bridge management

### Task 6: Remove Element/Matrix service install logic from bloom-services

**Files:**
- Modify: `extensions/bloom-services/index.ts`
- Modify: `extensions/bloom-services/actions-test.ts`
- Delete: `extensions/bloom-services/matrix-register.ts`
- Modify: `extensions/bloom-services/actions-install.ts`
- Modify: `extensions/bloom-services/service-io.ts`

- [ ] **Step 1: Remove service_pair tool from index.ts**

In `extensions/bloom-services/index.ts`, remove the `service_pair` tool registration (lines 82-96) and the import of `handlePair` from `./actions-test.js` (line 18).

- [ ] **Step 2: Remove handlePair from actions-test.ts**

In `extensions/bloom-services/actions-test.ts`, delete the `handlePair` function (lines 115-218) and remove the import of `registerMatrixAccount` from `./matrix-register.js`.

- [ ] **Step 3: Delete matrix-register.ts**

```bash
rm extensions/bloom-services/matrix-register.ts
```

- [ ] **Step 4: Remove matrix-specific env generation from service-io.ts**

In `extensions/bloom-services/service-io.ts`, remove the matrix-specific block that generates `CONTINUWUITY_REGISTRATION_TOKEN` in the env file (around lines 111-122). Keep the generic env file creation for other services.

- [ ] **Step 5: Run tests**

Run: `npm run test -- tests/extensions/bloom-services.test.ts tests/extensions/bloom-services-pair.test.ts`

Fix any broken tests. The `bloom-services-pair.test.ts` may need to be deleted or rewritten since `handlePair` is gone.

- [ ] **Step 6: Commit**

```bash
git add extensions/bloom-services/ tests/extensions/
git commit -m "refactor: remove Element/Matrix service install and pairing from bloom-services"
```

---

### Task 7: Add bridge management tools to bloom-services

**Files:**
- Create: `extensions/bloom-services/actions-bridges.ts`
- Modify: `extensions/bloom-services/index.ts`
- Create: `tests/extensions/bloom-services-bridges.test.ts`
- Modify: `services/catalog.yaml`

- [ ] **Step 1: Add bridges section to services/catalog.yaml**

Append to `services/catalog.yaml`:

```yaml

bridges:
  whatsapp:
    image: dock.mau.dev/mautrix/whatsapp:latest
    auth_method: qr_code
    health_port: 29318
    description: Bridge WhatsApp conversations to Matrix
  telegram:
    image: dock.mau.dev/mautrix/telegram:latest
    auth_method: phone_code
    health_port: 29300
    description: Bridge Telegram conversations to Matrix
  signal:
    image: dock.mau.dev/mautrix/signal:latest
    auth_method: qr_code
    health_port: 29328
    description: Bridge Signal conversations to Matrix
```

- [ ] **Step 2: Update lib/services-catalog.ts to load bridges**

Add a `loadBridgeCatalog(repoDir)` function that reads the `bridges` key from `catalog.yaml`, similar to `loadServiceCatalog` but returning `doc.bridges`.

- [ ] **Step 3: Write tests for bridge management actions**

```typescript
// tests/extensions/bloom-services-bridges.test.ts
import { describe, expect, it } from "vitest";

describe("bridge catalog", () => {
	it("loads bridge entries from catalog.yaml", async () => {
		const { loadBridgeCatalog } = await import("../../lib/services-catalog.js");
		const bridges = loadBridgeCatalog(process.cwd());
		expect(bridges).toHaveProperty("whatsapp");
		expect(bridges).toHaveProperty("telegram");
		expect(bridges).toHaveProperty("signal");
		expect(bridges.whatsapp.image).toContain("mautrix/whatsapp");
	});
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm run test -- tests/extensions/bloom-services-bridges.test.ts`
Expected: FAIL — `loadBridgeCatalog` does not exist yet.

- [ ] **Step 5: Implement loadBridgeCatalog in lib/services-catalog.ts**

Add to `lib/services-catalog.ts`:

```typescript
export interface BridgeCatalogEntry {
	image: string;
	auth_method: string;
	health_port: number;
	description: string;
}

export function loadBridgeCatalog(repoDir: string): Record<string, BridgeCatalogEntry> {
	// Same candidate paths as loadServiceCatalog
	const candidates = [
		join(repoDir, "services", "catalog.yaml"),
		join("/usr/local/share/bloom", "services", "catalog.yaml"),
		join(process.cwd(), "services", "catalog.yaml"),
	];
	for (const p of candidates) {
		if (existsSync(p)) {
			const raw = readFileSync(p, "utf-8");
			const doc = yaml.load(raw) as { bridges?: Record<string, BridgeCatalogEntry> };
			return doc.bridges ?? {};
		}
	}
	return {};
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test -- tests/extensions/bloom-services-bridges.test.ts`
Expected: PASS

- [ ] **Step 7: Implement actions-bridges.ts**

```typescript
// extensions/bloom-services/actions-bridges.ts
/**
 * Bridge lifecycle management: create, remove, status.
 * Manages mautrix bridge containers that connect external messaging
 * platforms (WhatsApp, Telegram, Signal) to the local Matrix homeserver.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { createLogger, errorResult } from "../../lib/shared.js";
import { loadBridgeCatalog, type BridgeCatalogEntry } from "../../lib/services-catalog.js";

const log = createLogger("bloom-bridges");

const QUADLET_DIR = join(os.homedir(), ".config", "containers", "systemd");
const BRIDGE_CONFIG_DIR = join(os.homedir(), ".config", "bloom", "bridges");

function bridgeQuadletName(protocol: string): string {
	return `bloom-bridge-${protocol}`;
}

function bridgeQuadletPath(protocol: string): string {
	return join(QUADLET_DIR, `${bridgeQuadletName(protocol)}.container`);
}

/**
 * Generate a Quadlet .container file for a mautrix bridge.
 * Uses default slirp4netns networking — bridge config points at
 * host.containers.internal:6167 to reach the native Continuwuity.
 * No After=bloom-matrix.service (user-level units can't order after system-level).
 * Mautrix bridges handle homeserver unavailability with their own retry logic.
 */
function generateBridgeQuadlet(protocol: string, entry: BridgeCatalogEntry): string {
	const name = bridgeQuadletName(protocol);
	const configDir = join(BRIDGE_CONFIG_DIR, protocol);
	return `[Unit]
Description=Bloom Bridge: ${protocol} (mautrix)

[Container]
Image=${entry.image}
ContainerName=${name}
Volume=${configDir}:/data:Z
HealthCmd=wget -qO- http://localhost:${entry.health_port}/api/v1/health || exit 1
HealthInterval=30s
HealthTimeout=10s
HealthStartPeriod=60s
HealthRetries=3

[Service]
Restart=on-failure
RestartSec=10
TimeoutStartSec=300

[Install]
WantedBy=default.target
`;
}

/** Create and start a bridge container. */
export async function handleBridgeCreate(
	params: { protocol: string },
	repoDir: string,
	signal?: AbortSignal,
) {
	const catalog = loadBridgeCatalog(repoDir);
	const entry = catalog[params.protocol];
	if (!entry) {
		const available = Object.keys(catalog).join(", ");
		return errorResult(`Unknown bridge protocol: "${params.protocol}". Available: ${available}`);
	}

	// Create config directory
	const configDir = join(BRIDGE_CONFIG_DIR, params.protocol);
	if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });

	// Generate Quadlet file
	const quadletContent = generateBridgeQuadlet(params.protocol, entry);
	const quadletPath = bridgeQuadletPath(params.protocol);
	if (!existsSync(QUADLET_DIR)) mkdirSync(QUADLET_DIR, { recursive: true });
	writeFileSync(quadletPath, quadletContent, "utf-8");

	// Generate bridge config with homeserver pointing to host
	const bridgeConfig = join(configDir, "config.yaml");
	if (!existsSync(bridgeConfig)) {
		// mautrix bridges auto-generate config on first run,
		// but we need to set the homeserver address
		writeFileSync(bridgeConfig, `homeserver:\n  address: http://host.containers.internal:6167\n  domain: bloom\n`, "utf-8");
	}

	// Pull image
	log.info(`pulling bridge image: ${entry.image}`);
	await execa("podman", ["pull", entry.image], { signal });

	// Generate and register appservice with Continuwuity
	// mautrix bridges generate registration.yaml on first run
	// After first run, copy it to /etc/bloom/appservices/ and reload Continuwuity
	const appserviceDir = "/etc/bloom/appservices";
	const appserviceFile = join(appserviceDir, `${params.protocol}.yaml`);
	// Note: appservice registration happens after first bridge start.
	// The bridge generates registration.yaml in its data dir on first run.
	// Pi should then copy it and reload Continuwuity:
	//   sudo cp {configDir}/registration.yaml {appserviceFile}
	//   sudo systemctl reload bloom-matrix

	// Reload systemd and start
	await execa("systemctl", ["--user", "daemon-reload"], { signal });
	const unitName = `${bridgeQuadletName(params.protocol)}.service`;
	await execa("systemctl", ["--user", "start", unitName], { signal });

	// After first start, register appservice if registration.yaml was generated
	const regFile = join(configDir, "registration.yaml");
	if (existsSync(regFile)) {
		await execa("sudo", ["cp", regFile, appserviceFile], { signal });
		await execa("sudo", ["systemctl", "reload", "bloom-matrix"], { signal });
		log.info(`registered appservice for ${params.protocol}`);
	} else {
		log.info(`bridge ${params.protocol} started — appservice registration may need a second run after config generation`);
	}

	const authMsg = entry.auth_method === "qr_code"
		? "Open Cinny and look for the bridge bot room. Scan the QR code it posts to authenticate."
		: "Open Cinny and look for the bridge bot room. Send your phone number to authenticate.";

	return {
		content: [{
			type: "text" as const,
			text: `Bridge "${params.protocol}" created and started.\n\n${authMsg}`,
		}],
		details: { protocol: params.protocol, unit: unitName, auth_method: entry.auth_method },
	};
}

/** Stop and remove a bridge container. */
export async function handleBridgeRemove(
	params: { protocol: string },
	signal?: AbortSignal,
) {
	const unitName = `${bridgeQuadletName(params.protocol)}.service`;
	const quadletPath = bridgeQuadletPath(params.protocol);

	// Stop service
	try {
		await execa("systemctl", ["--user", "stop", unitName], { signal });
	} catch {
		// may not be running
	}

	// Remove Quadlet file
	if (existsSync(quadletPath)) {
		unlinkSync(quadletPath);
	}

	// Reload systemd
	await execa("systemctl", ["--user", "daemon-reload"], { signal });

	return {
		content: [{ type: "text" as const, text: `Bridge "${params.protocol}" removed.` }],
		details: { protocol: params.protocol },
	};
}

/** List active bridges with status. */
export async function handleBridgeStatus(signal?: AbortSignal) {
	const { stdout } = await execa(
		"podman", ["ps", "-a", "--format=json", "--filter", "name=bloom-bridge-"],
		{ signal },
	);
	const containers = JSON.parse(stdout || "[]") as Array<{
		Names: string[];
		State: string;
		Image: string;
	}>;

	if (containers.length === 0) {
		return {
			content: [{ type: "text" as const, text: "No bridges installed." }],
			details: { bridges: [] },
		};
	}

	const lines = containers.map((c) => {
		const name = c.Names[0]?.replace("bloom-bridge-", "") ?? "unknown";
		return `- **${name}**: ${c.State} (${c.Image})`;
	});

	return {
		content: [{ type: "text" as const, text: `Active bridges:\n${lines.join("\n")}` }],
		details: { bridges: containers.map((c) => ({ name: c.Names[0], state: c.State })) },
	};
}
```

- [ ] **Step 8: Register bridge tools in index.ts**

Add to `extensions/bloom-services/index.ts`:

```typescript
import { handleBridgeCreate, handleBridgeRemove, handleBridgeStatus } from "./actions-bridges.js";
```

Register three new tools:

```typescript
pi.registerTool({
	name: "bridge_create",
	label: "Create Bridge",
	description: "Create and start a Matrix bridge to an external messaging platform (WhatsApp, Telegram, Signal).",
	parameters: Type.Object({
		protocol: Type.String({ description: "Bridge protocol (whatsapp, telegram, signal)" }),
	}),
	async execute(_toolCallId, params, signal) {
		return handleBridgeCreate(params, repoDir, signal);
	},
});

pi.registerTool({
	name: "bridge_remove",
	label: "Remove Bridge",
	description: "Stop and remove a Matrix bridge.",
	parameters: Type.Object({
		protocol: Type.String({ description: "Bridge protocol to remove" }),
	}),
	async execute(_toolCallId, params, signal) {
		return handleBridgeRemove(params, signal);
	},
});

pi.registerTool({
	name: "bridge_status",
	label: "Bridge Status",
	description: "List active Matrix bridges and their connection status.",
	parameters: Type.Object({}),
	async execute(_toolCallId, _params, signal) {
		return handleBridgeStatus(signal);
	},
});
```

- [ ] **Step 9: Run tests**

Run: `npm run test`
Expected: PASS

- [ ] **Step 10: Run biome check**

Run: `npm run check`

- [ ] **Step 11: Commit**

```bash
git add extensions/bloom-services/ lib/services-catalog.ts services/catalog.yaml tests/extensions/
git commit -m "feat: add bridge management tools (bridge_create, bridge_remove, bridge_status)"
```

---

## Chunk 5: Update setup flow, skills, catalog, and ARCHITECTURE.md

### Task 8: Update setup step order and guidance

**Files:**
- Modify: `lib/setup.ts`
- Modify: `extensions/bloom-setup/step-guidance.ts`
- Modify: `tests/lib/setup.test.ts`

- [ ] **Step 1: Update STEP_ORDER in lib/setup.ts**

Replace `"channels"` with `"matrix"` in the STEP_ORDER array. The step now verifies Continuwuity is running and creates accounts rather than installing services.

```typescript
export const STEP_ORDER = [
	"welcome",
	"network",
	"netbird",
	"connectivity",
	"webdav",
	"matrix",
	"git_identity",
	"contributing",
	"persona",
	"test_message",
	"complete",
] as const;
```

- [ ] **Step 2: Update step guidance for the "matrix" step**

In `extensions/bloom-setup/step-guidance.ts`, replace the `channels` entry with `matrix`:

```typescript
matrix:
	"Matrix is your private communication hub — it's already running on this device. Verify Continuwuity is healthy: systemctl status bloom-matrix. Then create accounts:\n\n1. Generate a registration token if not already present (check /var/lib/continuwuity/registration_token)\n2. Register @pi:bloom bot account using the Matrix registration API\n3. Register @user:bloom account for the human user\n4. Store credentials in ~/.pi/matrix-credentials.json\n5. Create #general:bloom room\n6. Tell the user: 'Your Matrix homeserver is running. Open Cinny at http://<hostname>/cinny to chat. Your login is @user:bloom with the password shown below.'\n7. Ask: 'Want me to connect your WhatsApp, Telegram, or Signal?'",
```

- [ ] **Step 3: Update setup tests**

In `tests/lib/setup.test.ts`, update any references to the `"channels"` step to use `"matrix"` instead.

- [ ] **Step 4: Run tests**

Run: `npm run test -- tests/lib/setup.test.ts tests/extensions/bloom-setup.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/setup.ts extensions/bloom-setup/step-guidance.ts tests/lib/setup.test.ts
git commit -m "refactor: rename setup step 'channels' to 'matrix' with native homeserver guidance"
```

---

### Task 9: Update service catalog — remove matrix and element entries

**Files:**
- Modify: `services/catalog.yaml`
- Modify: `tests/lib/services.test.ts` (if it references matrix/element entries)

- [ ] **Step 1: Remove matrix and element from services section**

In `services/catalog.yaml`, remove the `matrix` and `element` entries from the `services:` section. Keep `dufs` and `code-server`.

The file should look like:

```yaml
services:
  dufs:
    version: 0.1.0
    category: sync
    image: docker.io/sigoden/dufs:v0.38.0
    optional: false
    preflight:
      commands: [podman, systemctl]
  code-server:
    version: 0.1.0
    category: development
    image: localhost/bloom-code-server:latest
    optional: true
    preflight:
      commands: [podman, systemctl]

bridges:
  whatsapp:
    image: dock.mau.dev/mautrix/whatsapp:latest
    auth_method: qr_code
    description: Bridge WhatsApp conversations to Matrix
  telegram:
    image: dock.mau.dev/mautrix/telegram:latest
    auth_method: phone_code
    description: Bridge Telegram conversations to Matrix
  signal:
    image: dock.mau.dev/mautrix/signal:latest
    auth_method: qr_code
    description: Bridge Signal conversations to Matrix
```

- [ ] **Step 2: Update any tests that reference matrix/element catalog entries**

Run: `grep -rn "catalog.*matrix\|catalog.*element" tests/`

Fix any tests that expect matrix or element in the catalog.

- [ ] **Step 3: Run tests**

Run: `npm run test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add services/catalog.yaml tests/
git commit -m "refactor: remove matrix/element from service catalog (now OS infrastructure)"
```

---

### Task 10: Migrate and update skills

**Files:**
- Create: `skills/bridges.md`
- Move content: `services/matrix/SKILL.md` concepts → `skills/` (as part of existing Matrix skill or new file)
- Keep: `services/netbird/SKILL.md` (no changes)

- [ ] **Step 1: Create skills/ directory and bridges skill**

Note: The `skills/` directory does not exist yet in the repo. Existing skill files live at `services/{name}/SKILL.md`. Create the `skills/` directory for OS-level skills that aren't tied to a specific service.

```markdown
---
name: bridges
description: How Pi manages Matrix bridges to external messaging platforms
---

# Matrix Bridges

You can bridge external messaging platforms to your local Matrix homeserver. Each bridge runs as a Podman container managed by Pi.

## Available Bridges

| Platform | Protocol | Auth Method |
|----------|----------|-------------|
| WhatsApp | whatsapp | QR code scan |
| Telegram | telegram | Phone number + code |
| Signal | signal | QR code scan |

## Creating a Bridge

Use `bridge_create(protocol)` to set up a bridge. Pi will:
1. Pull the bridge container image
2. Configure it to connect to the local Continuwuity homeserver
3. Start it as a systemd service
4. Guide you through authentication

## Authentication

After creating a bridge, open Cinny at `http://<hostname>/cinny` and look for the bridge bot room. Follow the bot's instructions:
- **QR code bridges** (WhatsApp, Signal): Scan the QR code with your phone
- **Phone code bridges** (Telegram): Enter your phone number, then the verification code

## Managing Bridges

- `bridge_status()` — List active bridges and their connection status
- `bridge_remove(protocol)` — Stop and remove a bridge

## How It Works

Bridges connect external platforms to Matrix rooms. When someone messages you on WhatsApp, the bridge creates a Matrix room for that conversation. You see and reply to messages in Cinny (or any Matrix client). Pi can also read and respond in these rooms.
```

- [ ] **Step 2: Update the existing Matrix SKILL.md for native homeserver context**

The existing `services/matrix/SKILL.md` references container-specific details. Since this file will be installed to `~/Bloom/Skills/matrix/SKILL.md` during first boot (or may already be there), update it to reflect the native service:

Note: The actual migration of this file depends on how skills are installed. If `service_install("matrix")` was used before to copy it, the new setup flow should copy updated skill files from the repo's `skills/` directory instead. This is handled in the setup step, not as a separate task.

- [ ] **Step 3: Commit**

```bash
git add skills/bridges.md
git commit -m "feat: add bridges skill for Matrix bridge management"
```

---

### Task 11: Update ARCHITECTURE.md with OS-level infrastructure tier

**Files:**
- Modify: `ARCHITECTURE.md`

- [ ] **Step 1: Add OS-level infrastructure tier**

Add a section after the "Three-Tier Model" section explaining the OS-level infrastructure tier:

```markdown
### OS-Level Infrastructure

Some services are foundational to the system's identity and run as native systemd services baked into the OS image, not as containers. This is the exception to "containers first" — it applies only to services that every other feature depends on.

**Current OS-level infrastructure:**
- **Continuwuity** (Matrix homeserver) — `bloom-matrix.service`, communication backbone
- **NetBird** — mesh networking, device reachability
- **Nginx** — reverse proxy, serves Cinny web client

These are analogous to systemd, podman, and SSH — they're part of the OS, not optional services.
```

- [ ] **Step 2: Update the service structure section**

Note that Matrix bridges follow the standard service/container pattern while the homeserver itself is OS-level.

- [ ] **Step 3: Commit**

```bash
git add ARCHITECTURE.md
git commit -m "docs: add OS-level infrastructure tier to ARCHITECTURE.md"
```

---

## Chunk 6: Delete old code and final cleanup

### Task 12: Delete services/element/ directory

**Files:**
- Delete: `services/element/` (entire directory)

- [ ] **Step 1: Remove the directory**

```bash
rm -rf services/element/
```

- [ ] **Step 2: Check for any remaining imports or references**

Run: `grep -rn "services/element\|bloom-element\|element\.env" --include='*.ts' --include='*.yaml' --include='*.toml'`

Fix any remaining references.

- [ ] **Step 3: Remove bloom-services-pair.test.ts if it only tests the removed handlePair**

Check the contents of `tests/extensions/bloom-services-pair.test.ts`. If it only tests `handlePair` (which was removed in Task 6), delete it.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: delete services/element/ directory (replaced by in-process Matrix client)"
```

---

### Task 13: Clean up services/matrix/ Quadlet files

**Files:**
- Delete: `services/matrix/quadlet/` (Quadlet container unit files)
- Keep: `services/matrix/SKILL.md` (reference material, may be migrated to skills/)

- [ ] **Step 1: Remove Quadlet files**

```bash
rm -rf services/matrix/quadlet/
```

- [ ] **Step 2: Check for references to the Quadlet files**

Run: `grep -rn "bloom-matrix\.container" --include='*.ts'`

Fix any references in `service-io.ts` or `actions-test.ts` that check for `bloom-matrix.container`.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove matrix Quadlet files (Continuwuity is now a native systemd service)"
```

---

### Task 14: Remove stale references and run final validation

**Files:**
- Various: grep-driven cleanup

- [ ] **Step 1: Search for all stale references**

Run these searches and fix anything found:

```bash
# Socket-related
grep -rn "channels\.sock\|BLOOM_CHANNELS_SOCKET\|channel-tokens" --include='*.ts'

# Element bridge references
grep -rn "bloom-element\|element\.env\|BLOOM_MATRIX_PASSWORD" --include='*.ts'

# Old pairing exports
grep -rn "getPairingData\|setPairingData\|clearPairingData" --include='*.ts'

# Old channel-server imports
grep -rn "channel-server\|createChannelBridge" --include='*.ts'
```

- [ ] **Step 2: Run full test suite**

Run: `npm run test`
Expected: ALL PASS

- [ ] **Step 3: Run biome check**

Run: `npm run check`
Expected: PASS

- [ ] **Step 4: Run TypeScript build**

Run: `npm run build`
Expected: PASS with no errors

- [ ] **Step 5: Commit any remaining fixes**

```bash
git add -A
git commit -m "chore: clean up stale references from Matrix/Element migration"
```

---

### Task 15: Final integration verification

- [ ] **Step 1: Build the OS image**

Run: `just build`
Expected: Image builds successfully with Continuwuity binary, Cinny static files, and bloom-matrix.service.

- [ ] **Step 2: Boot VM and verify**

Run: `just vm`

Verify:
- `systemctl status bloom-matrix` shows active
- `curl http://localhost:6167/_matrix/client/versions` returns JSON
- `curl http://localhost/cinny` serves the Cinny web app
- `curl http://localhost/_matrix/client/versions` (via nginx proxy) returns JSON

- [ ] **Step 3: Test first-boot setup flow**

With a fresh VM, run through the setup wizard and verify the "matrix" step:
- Creates @pi:bloom and @user:bloom accounts
- Stores credentials
- Pi can connect to Matrix

- [ ] **Step 4: Commit any final fixes discovered during integration testing**
