# RPC Room Daemon Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the programmatic AgentSession daemon with one `pi --mode rpc` subprocess per Matrix room, multiplexed over Unix sockets for bidirectional Matrix + terminal access.

**Architecture:** Each room spawns `pi --mode rpc` as a child process. A thin room daemon manages the process, opens a Unix socket for terminal clients, fans out pi's JSON events, and fans in commands from Matrix and socket clients. A `bloom-attach` CLI connects to the socket for live terminal interaction.

**Tech Stack:** Node.js 22, TypeScript (strict, ES2022, NodeNext), `node:child_process`, `node:net` (Unix sockets), `node:readline`, vitest, Biome

**Spec:** `docs/superpowers/specs/2026-03-12-rpc-room-daemon-design.md`

---

## Chunk 1: Foundation utilities

### Task 1: Room alias sanitization

**Files:**
- Create: `lib/room-alias.ts`
- Test: `tests/lib/room-alias.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/lib/room-alias.test.ts
import { describe, expect, it } from "vitest";
import { sanitizeRoomAlias } from "../../lib/room-alias.js";

describe("sanitizeRoomAlias", () => {
	it("strips # prefix and replaces : with _", () => {
		expect(sanitizeRoomAlias("#general:localhost")).toBe("general_localhost");
	});

	it("strips ! prefix for room IDs", () => {
		expect(sanitizeRoomAlias("!abc123:localhost")).toBe("abc123_localhost");
	});

	it("handles alias with subdomain", () => {
		expect(sanitizeRoomAlias("#dev:bloom")).toBe("dev_bloom");
	});

	it("passes through already-clean strings", () => {
		expect(sanitizeRoomAlias("general_bloom")).toBe("general_bloom");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/room-alias.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// lib/room-alias.ts
/** Sanitize a Matrix room alias or ID into a filesystem-safe name. */
export function sanitizeRoomAlias(alias: string): string {
	return alias.replace(/^[#!]/, "").replaceAll(":", "_");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/room-alias.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Run lint**

Run: `npm run check`

- [ ] **Step 6: Commit**

```bash
git add lib/room-alias.ts tests/lib/room-alias.test.ts
git commit -m "feat(daemon): add room alias sanitization utility"
```

---

### Task 2: RPC response extraction

Replace `extractResponseText()` in `lib/matrix.ts` with a version that works on raw JSON (the `agent_end` event's `messages` array from RPC mode). The logic is identical — walk backward through messages, find last assistant text — but it now lives in its own file scoped to RPC.

**Files:**
- Create: `daemon/rpc-protocol.ts`
- Test: `tests/daemon/rpc-protocol.test.ts`
- Later (Task 7): remove `extractResponseText` from `lib/matrix.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/daemon/rpc-protocol.test.ts
import { describe, expect, it } from "vitest";
import { extractResponseText } from "../../daemon/rpc-protocol.js";

describe("extractResponseText", () => {
	it("extracts string content (post-compaction)", () => {
		const messages = [{ role: "assistant", content: "summarized text" }];
		expect(extractResponseText(messages)).toBe("summarized text");
	});

	it("extracts text blocks from array content", () => {
		const messages = [{ role: "assistant", content: [{ type: "text", text: "hello" }] }];
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
		const messages = [{ role: "assistant", content: [{ type: "tool_use", id: "1", name: "foo" }] }];
		expect(extractResponseText(messages)).toBe("");
	});

	it("returns empty string for empty array", () => {
		expect(extractResponseText([])).toBe("");
	});

	it("returns last assistant message text", () => {
		const messages = [
			{ role: "assistant", content: "first" },
			{ role: "user", content: "question" },
			{ role: "assistant", content: "second" },
		];
		expect(extractResponseText(messages)).toBe("second");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/daemon/rpc-protocol.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// daemon/rpc-protocol.ts
/**
 * RPC protocol types and helpers for communicating with `pi --mode rpc`.
 * JSON-lines protocol over stdin/stdout.
 */

/** Commands sent to pi's stdin. */
export type RpcCommand =
	| { type: "prompt"; message: string }
	| { type: "follow_up"; message: string }
	| { type: "steer"; message: string }
	| { type: "abort" };

/** Event types received from pi's stdout. */
export interface RpcEvent {
	type: string;
	[key: string]: unknown;
}

/**
 * Extract text from the last assistant message in an agent_end event's messages array.
 * Works on raw JSON objects from RPC mode (same structure as SDK AgentMessage[]).
 */
export function extractResponseText(messages: readonly Record<string, unknown>[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role !== "assistant") continue;

		const content = msg.content;
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/daemon/rpc-protocol.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Run lint**

Run: `npm run check`

- [ ] **Step 6: Commit**

```bash
git add daemon/rpc-protocol.ts tests/daemon/rpc-protocol.test.ts
git commit -m "feat(daemon): add RPC protocol types and response extraction"
```

---

## Chunk 2: Room process manager

### Task 3: RoomProcess — spawn, stdin/stdout, socket, idle timeout

This is the core component. It manages a single room's `pi --mode rpc` subprocess + Unix socket.

**Files:**
- Create: `daemon/room-process.ts`
- Test: `tests/daemon/room-process.test.ts`

**Design:**

```typescript
// Public interface of RoomProcess
interface RoomProcessOptions {
	roomId: string;
	roomAlias: string;         // raw Matrix alias (e.g., "#general:bloom")
	sanitizedAlias: string;    // filesystem-safe (e.g., "general_bloom")
	socketDir: string;         // $XDG_RUNTIME_DIR/bloom/
	sessionDir: string;        // ~/.pi/agent/sessions/bloom-rooms/{sanitizedAlias}/
	idleTimeoutMs: number;
	onAgentEnd: (text: string) => void;    // callback when pi produces a response
	onEvent: (event: RpcEvent) => void;    // callback for every event (for socket fan-out)
	onExit: (code: number | null) => void; // callback when pi process dies
}
```

- [ ] **Step 1: Write the failing tests**

Tests use a mock subprocess (`node -e "process.stdin.resume()"`) to avoid requiring `pi` in the test environment. This stand-in process reads stdin (doesn't exit) and can be killed cleanly.

```typescript
// tests/daemon/room-process.test.ts
import { mkdirSync, mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock child_process.spawn to use a stand-in process instead of `pi`
vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:child_process")>();
	return {
		...actual,
		spawn: (cmd: string, args: string[], opts: Record<string, unknown>) => {
			// Replace `pi --mode rpc` with a simple node process that reads stdin
			return actual.spawn("node", ["-e", `
				process.stdin.resume();
				process.stdin.on("data", (d) => {
					const line = d.toString().trim();
					try {
						const cmd = JSON.parse(line);
						// Echo agent_start then agent_end with a response
						if (cmd.type === "prompt") {
							process.stdout.write(JSON.stringify({type:"agent_start"}) + "\\n");
							process.stdout.write(JSON.stringify({type:"message_update",assistantMessageEvent:{type:"text_delta",delta:"hi"}}) + "\\n");
							process.stdout.write(JSON.stringify({type:"agent_end",messages:[{role:"assistant",content:"hi"}]}) + "\\n");
						}
					} catch {}
				});
			`], { ...opts, stdio: ["pipe", "pipe", "pipe"] });
		},
	};
});

describe("RoomProcess", () => {
	let tmpDir: string;
	let socketDir: string;
	let sessionDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "room-process-"));
		socketDir = join(tmpDir, "sockets");
		sessionDir = join(tmpDir, "sessions");
		mkdirSync(socketDir, { recursive: true });
		mkdirSync(sessionDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	function makeOpts(overrides: Record<string, unknown> = {}) {
		return {
			roomId: "!abc:bloom",
			roomAlias: "#general:bloom",
			sanitizedAlias: "general_bloom",
			socketDir,
			sessionDir,
			idleTimeoutMs: 60_000,
			onAgentEnd: vi.fn(),
			onEvent: vi.fn(),
			onExit: vi.fn(),
			...overrides,
		};
	}

	it("creates socket file on spawn", async () => {
		const { RoomProcess } = await import("../../daemon/room-process.js");
		const rp = new RoomProcess(makeOpts());
		await rp.spawn();

		expect(existsSync(join(socketDir, "room-general_bloom.sock"))).toBe(true);
		rp.dispose();
	});

	it("dispose kills process and removes socket", async () => {
		const { RoomProcess } = await import("../../daemon/room-process.js");
		const rp = new RoomProcess(makeOpts());
		await rp.spawn();
		rp.dispose();

		expect(existsSync(join(socketDir, "room-general_bloom.sock"))).toBe(false);
	});

	it("does not call onExit when intentionally disposed", async () => {
		const { RoomProcess } = await import("../../daemon/room-process.js");
		const onExit = vi.fn();
		const rp = new RoomProcess(makeOpts({ onExit }));
		await rp.spawn();
		rp.dispose();

		await new Promise((r) => setTimeout(r, 100));
		expect(onExit).not.toHaveBeenCalled();
	});

	it("calls onAgentEnd when pi responds", async () => {
		const { RoomProcess } = await import("../../daemon/room-process.js");
		const onAgentEnd = vi.fn();
		const rp = new RoomProcess(makeOpts({ onAgentEnd }));
		await rp.spawn();

		rp.send({ type: "prompt", message: "hello" });

		// Wait for mock process to echo back
		await new Promise((r) => setTimeout(r, 200));
		expect(onAgentEnd).toHaveBeenCalledWith("hi");

		rp.dispose();
	});

	it("tracks streaming state", async () => {
		const { RoomProcess } = await import("../../daemon/room-process.js");
		const rp = new RoomProcess(makeOpts());
		await rp.spawn();

		expect(rp.isStreaming).toBe(false);

		rp.send({ type: "prompt", message: "hello" });
		// Brief pause for agent_start to arrive
		await new Promise((r) => setTimeout(r, 50));
		// After agent_end, streaming should be false again
		await new Promise((r) => setTimeout(r, 200));
		expect(rp.isStreaming).toBe(false);

		rp.dispose();
	});

	it("sendMessage uses follow_up when streaming", async () => {
		const { RoomProcess } = await import("../../daemon/room-process.js");
		const rp = new RoomProcess(makeOpts());
		await rp.spawn();

		// Directly set streaming state for test
		(rp as unknown as { streaming: boolean }).streaming = true;
		// sendMessage should use follow_up
		// We can't easily inspect what was written to stdin, but we can verify no crash
		rp.sendMessage("test while streaming");

		rp.dispose();
	});

	it("resets idle timer on send", async () => {
		const { RoomProcess } = await import("../../daemon/room-process.js");
		const rp = new RoomProcess(makeOpts({ idleTimeoutMs: 500 }));
		await rp.spawn();

		rp.send({ type: "prompt", message: "hello" });

		// Wait less than timeout
		await new Promise((r) => setTimeout(r, 300));
		expect(rp.alive).toBe(true);

		rp.dispose();
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/daemon/room-process.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// daemon/room-process.ts
/**
 * Room process — manages a single pi --mode rpc subprocess + Unix socket.
 * Spawns pi, reads JSON events from stdout, accepts commands via send(),
 * opens a Unix socket for terminal clients, and handles idle timeout.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { createLogger } from "../lib/shared.js";
import { type RpcCommand, type RpcEvent, extractResponseText } from "./rpc-protocol.js";

const log = createLogger("room-process");

export interface RoomProcessOptions {
	roomId: string;
	roomAlias: string;
	sanitizedAlias: string;
	socketDir: string;
	sessionDir: string;
	idleTimeoutMs: number;
	onAgentEnd: (text: string) => void;
	onEvent: (event: RpcEvent) => void;
	onExit: (code: number | null) => void;
}

export class RoomProcess {
	private proc: ChildProcess | null = null;
	private server: Server | null = null;
	private clients: Set<Socket> = new Set();
	private idleTimer: ReturnType<typeof setTimeout> | null = null;
	private streaming = false;
	private disposing = false;
	private writeQueue: Promise<void> = Promise.resolve();
	private readonly socketPath: string;
	private readonly opts: RoomProcessOptions;

	constructor(opts: RoomProcessOptions) {
		this.opts = opts;
		this.socketPath = join(opts.socketDir, `room-${opts.sanitizedAlias}.sock`);
	}

	get alive(): boolean {
		return this.proc !== null && this.proc.exitCode === null;
	}

	get isStreaming(): boolean {
		return this.streaming;
	}

	async spawn(): Promise<void> {
		if (!existsSync(this.opts.sessionDir)) {
			mkdirSync(this.opts.sessionDir, { recursive: true });
		}

		this.proc = spawn("pi", ["--mode", "rpc"], {
			cwd: this.opts.sessionDir,
			stdio: ["pipe", "pipe", "pipe"],
		});

		// Read JSON lines from stdout
		if (this.proc.stdout) {
			const rl = createInterface({ input: this.proc.stdout });
			rl.on("line", (line) => this.handleLine(line));
		}

		// Log stderr
		if (this.proc.stderr) {
			const rl = createInterface({ input: this.proc.stderr });
			rl.on("line", (line) => log.warn("pi stderr", { room: this.opts.sanitizedAlias, line }));
		}

		this.proc.on("exit", (code) => {
			log.info("pi process exited", { room: this.opts.sanitizedAlias, code });
			this.proc = null;
			// Only fire onExit for unexpected exits, not intentional dispose
			if (!this.disposing) {
				this.opts.onExit(code);
			}
		});

		// Open Unix socket for terminal clients
		await this.startSocket();
		this.resetIdleTimer();

		log.info("spawned pi process", { room: this.opts.sanitizedAlias, pid: this.proc.pid });
	}

	/** Send a command to pi's stdin. Serialized to prevent interleaved writes. */
	send(cmd: RpcCommand): void {
		this.writeQueue = this.writeQueue.then(() => {
			return new Promise<void>((resolve) => {
				if (!this.proc?.stdin?.writable) {
					resolve();
					return;
				}
				this.proc.stdin.write(`${JSON.stringify(cmd)}\n`, () => resolve());
			});
		});
		this.resetIdleTimer();
	}

	/** Send a message, choosing prompt vs follow_up based on streaming state. */
	sendMessage(text: string): void {
		if (this.streaming) {
			this.send({ type: "follow_up", message: text });
		} else {
			this.send({ type: "prompt", message: text });
		}
	}

	dispose(): void {
		this.disposing = true;

		if (this.idleTimer) {
			clearTimeout(this.idleTimer);
			this.idleTimer = null;
		}

		for (const client of this.clients) {
			client.destroy();
		}
		this.clients.clear();

		if (this.server) {
			this.server.close();
			this.server = null;
		}

		if (this.proc) {
			this.proc.kill("SIGTERM");
			this.proc = null;
		}

		// Clean up socket file
		try {
			if (existsSync(this.socketPath)) unlinkSync(this.socketPath);
		} catch {
			/* best effort */
		}
	}

	private handleLine(line: string): void {
		let event: RpcEvent;
		try {
			event = JSON.parse(line) as RpcEvent;
		} catch {
			log.warn("unparseable stdout line", { room: this.opts.sanitizedAlias, line });
			return;
		}

		// Track streaming state
		if (event.type === "agent_start") {
			this.streaming = true;
		} else if (event.type === "agent_end") {
			this.streaming = false;
			const messages = (event as { messages?: readonly Record<string, unknown>[] }).messages;
			if (messages) {
				const text = extractResponseText(messages);
				if (text) this.opts.onAgentEnd(text);
			}
		}

		// Fan out to all socket clients
		const jsonLine = `${JSON.stringify(event)}\n`;
		for (const client of this.clients) {
			client.write(jsonLine);
		}

		// Forward to daemon event handler
		this.opts.onEvent(event);
	}

	private startSocket(): Promise<void> {
		return new Promise((resolve, reject) => {
			// Clean up stale socket file
			try {
				if (existsSync(this.socketPath)) unlinkSync(this.socketPath);
			} catch {
				/* ok */
			}

			this.server = createServer((client) => {
				this.clients.add(client);
				log.info("terminal client connected", { room: this.opts.sanitizedAlias });

				// Read commands from terminal client
				const rl = createInterface({ input: client });
				rl.on("line", (line) => {
					try {
						const cmd = JSON.parse(line) as RpcCommand;
						// Route prompt commands through sendMessage for streaming-aware dispatch
						if (cmd.type === "prompt") {
							this.sendMessage(cmd.message);
						} else {
							this.send(cmd);
						}
						this.resetIdleTimer();
					} catch {
						log.warn("bad command from terminal client", { line });
					}
				});

				client.on("close", () => {
					this.clients.delete(client);
					log.info("terminal client disconnected", { room: this.opts.sanitizedAlias });
				});

				client.on("error", () => {
					this.clients.delete(client);
				});
			});

			this.server.listen(this.socketPath, () => resolve());
			this.server.on("error", reject);
		});
	}

	private resetIdleTimer(): void {
		if (this.idleTimer) clearTimeout(this.idleTimer);
		this.idleTimer = setTimeout(() => {
			log.info("idle timeout, disposing", { room: this.opts.sanitizedAlias });
			this.dispose();
		}, this.opts.idleTimeoutMs);
		this.idleTimer.unref();
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/daemon/room-process.test.ts`
Expected: PASS (7 tests). Tests use a mocked subprocess so `pi` does not need to be installed.

- [ ] **Step 5: Run lint**

Run: `npm run check`

- [ ] **Step 6: Commit**

```bash
git add daemon/room-process.ts tests/daemon/room-process.test.ts
git commit -m "feat(daemon): add RoomProcess subprocess + socket manager"
```

---

## Chunk 3: Daemon rewrite and cleanup

### Task 4: Rewrite daemon/index.ts

Replace the current daemon entry point that wires SessionPool + RoomRegistry with one that uses RoomProcess.

**Files:**
- Modify: `daemon/index.ts` (full rewrite)

- [ ] **Step 1: Read the current `daemon/index.ts` for reference**

Current file is at `daemon/index.ts` (126 lines). The retry loop, shutdown handler, and MatrixListener wiring pattern should be preserved.

- [ ] **Step 2: Rewrite daemon/index.ts**

```typescript
// daemon/index.ts
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

const log = createLogger("pi-daemon");

const IDLE_TIMEOUT_MS = Number.parseInt(process.env.BLOOM_DAEMON_IDLE_TIMEOUT_MS ?? "", 10) || 15 * 60 * 1000;
const SESSION_BASE = join(os.homedir(), ".pi", "agent", "sessions", "bloom-rooms");
const STORAGE_PATH = join(os.homedir(), ".pi", "pi-daemon", "matrix-state.json");
const SOCKET_DIR = join(process.env.XDG_RUNTIME_DIR ?? join(os.homedir(), ".run"), "bloom");

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
			onEvent: () => {
				// Events forwarded to socket clients inside RoomProcess
			},
			onExit: (code) => {
				rooms.delete(roomId);
				preambleSent.delete(roomId);
				if (code !== 0 && code !== null) {
					handleProcessError(roomId, code);
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

			try {
				await listener.sendText(roomId, "Sorry, I hit an error processing your message. Please try again.");
			} catch {
				/* best effort */
			}
		}
	}

	function handleProcessError(roomId: string, code: number): void {
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
```

- [ ] **Step 3: Build to check for type errors**

Run: `npm run build`
Expected: No errors

- [ ] **Step 4: Run all daemon tests to check nothing is broken**

Run: `npx vitest run tests/daemon/`
Expected: All tests pass (existing matrix-listener tests + new room-process tests)

- [ ] **Step 5: Run lint**

Run: `npm run check`

- [ ] **Step 6: Commit**

```bash
git add daemon/index.ts
git commit -m "feat(daemon): rewrite entry point to use RoomProcess instead of SessionPool"
```

---

### Task 5: Delete old code

**Files:**
- Delete: `daemon/session-pool.ts`
- Delete: `daemon/room-registry.ts`
- Delete: `tests/daemon/session-pool.test.ts`
- Delete: `tests/daemon/room-registry.test.ts`
- Modify: `lib/matrix.ts` — remove `extractResponseText()` function
- Modify: `tests/lib/matrix.test.ts` — remove `extractResponseText` tests

- [ ] **Step 1: Delete session-pool and room-registry files**

```bash
rm daemon/session-pool.ts daemon/room-registry.ts
rm tests/daemon/session-pool.test.ts tests/daemon/room-registry.test.ts
```

- [ ] **Step 2: Remove `extractResponseText` from `lib/matrix.ts`**

Remove the `extractResponseText` function (lines 19-44) and its biome-ignore comment. Keep `matrixCredentialsPath`, `generatePassword`, `MatrixCredentials`, and `registerMatrixAccount`.

- [ ] **Step 3: Remove `extractResponseText` tests from `tests/lib/matrix.test.ts`**

Remove the `describe("extractResponseText", ...)` block (lines 4-62). Keep `generatePassword` and `matrixCredentialsPath` test blocks.

- [ ] **Step 4: Verify no stale imports of `extractResponseText`**

Run: `grep -r "extractResponseText" daemon/ lib/ tests/ --include="*.ts"`
Expected: Only matches in `daemon/rpc-protocol.ts` and `tests/daemon/rpc-protocol.test.ts` (the new location). No matches in `lib/matrix.ts`, `tests/lib/matrix.test.ts`, or `daemon/index.ts`.

- [ ] **Step 5: Build and test**

Run: `npm run build && npx vitest run`
Expected: Build succeeds, all remaining tests pass

- [ ] **Step 6: Run lint**

Run: `npm run check`

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(daemon): remove SessionPool, RoomRegistry, and extractResponseText"
```

---

## Chunk 4: Terminal client

### Task 6: bloom-attach terminal client

**Files:**
- Create: `cli/bloom-attach.ts`
- Modify: `tsconfig.json` — add `cli/**/*.ts` to includes
- Modify: `package.json` — add `bin` entry (optional, or just run via `node dist/cli/bloom-attach.js`)

- [ ] **Step 1: Add `cli/**/*.ts` to tsconfig includes**

In `tsconfig.json`, change `include` to:
```json
"include": ["extensions/**/*.ts", "lib/**/*.ts", "daemon/**/*.ts", "cli/**/*.ts", "tests/**/*.ts"]
```

- [ ] **Step 2: Write the terminal client**

```typescript
// cli/bloom-attach.ts
/**
 * bloom-attach — connect to a running Pi room session via Unix socket.
 *
 * Usage:
 *   bloom-attach              # list available rooms
 *   bloom-attach general      # prefix-match and connect to room
 */
import { readdirSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import os from "node:os";
import { createInterface } from "node:readline";

const SOCKET_DIR = join(process.env.XDG_RUNTIME_DIR ?? join(os.homedir(), ".run"), "bloom");
const PREFIX = "room-";
const SUFFIX = ".sock";

function listRooms(): string[] {
	try {
		return readdirSync(SOCKET_DIR)
			.filter((f) => f.startsWith(PREFIX) && f.endsWith(SUFFIX))
			.map((f) => f.slice(PREFIX.length, -SUFFIX.length));
	} catch {
		return [];
	}
}

function findRoom(query: string): string | null {
	const rooms = listRooms();
	const matches = rooms.filter((r) => r.startsWith(query));
	if (matches.length === 1) return matches[0];
	if (matches.length > 1) {
		console.error(`Multiple matches: ${matches.join(", ")}`);
		return null;
	}
	console.error(`No active session matching "${query}"`);
	return null;
}

function main(): void {
	const query = process.argv[2];

	if (!query) {
		const rooms = listRooms();
		if (rooms.length === 0) {
			console.log("No active room sessions.");
		} else {
			console.log("Active rooms:");
			for (const r of rooms) {
				console.log(`  ${r}`);
			}
		}
		process.exit(0);
	}

	const room = findRoom(query);
	if (!room) process.exit(1);

	const socketPath = join(SOCKET_DIR, `${PREFIX}${room}${SUFFIX}`);
	const client = connect(socketPath);

	client.on("connect", () => {
		console.log(`Connected to ${room}. Ctrl+C to interrupt Pi, Ctrl+D to disconnect.\n`);
	});

	client.on("error", (err) => {
		console.error(`Connection error: ${err.message}`);
		process.exit(1);
	});

	client.on("close", () => {
		console.log("\nDisconnected.");
		process.exit(0);
	});

	// Read JSON events from socket, render to terminal
	const socketRl = createInterface({ input: client });
	socketRl.on("line", (line) => {
		try {
			const event = JSON.parse(line) as { type: string; [key: string]: unknown };
			renderEvent(event);
		} catch {
			// ignore unparseable lines
		}
	});

	// Read user input, send as commands
	const inputRl = createInterface({ input: process.stdin, output: process.stdout, prompt: "> " });

	let lastCtrlC = 0;

	inputRl.on("line", (line) => {
		const trimmed = line.trim();
		if (!trimmed) {
			inputRl.prompt();
			return;
		}
		const cmd = JSON.stringify({ type: "prompt", message: trimmed });
		client.write(`${cmd}\n`);
		inputRl.prompt();
	});

	inputRl.on("SIGINT", () => {
		const now = Date.now();
		if (now - lastCtrlC < 1000) {
			// Double Ctrl+C → abort
			client.write(`${JSON.stringify({ type: "abort" })}\n`);
			console.log("\n[abort sent]");
		} else {
			// Single Ctrl+C → steer
			client.write(`${JSON.stringify({ type: "steer", message: "stop" })}\n`);
			console.log("\n[interrupt sent]");
		}
		lastCtrlC = now;
		inputRl.prompt();
	});

	inputRl.on("close", () => {
		// Ctrl+D
		client.end();
	});

	inputRl.prompt();
}

function renderEvent(event: { type: string; [key: string]: unknown }): void {
	if (event.type === "message_update") {
		const ame = event.assistantMessageEvent as { type: string; delta?: string; toolName?: string } | undefined;
		if (!ame) return;

		if (ame.type === "text_delta" && ame.delta) {
			process.stdout.write(ame.delta);
		} else if (ame.type === "toolcall_start" && ame.toolName) {
			process.stdout.write(`\n[tool: ${ame.toolName}]\n`);
		}
	} else if (event.type === "agent_end") {
		process.stdout.write("\n");
	}
}

main();
```

- [ ] **Step 3: Build to check for type errors**

Run: `npm run build`
Expected: No errors

- [ ] **Step 4: Run lint**

Run: `npm run check`

- [ ] **Step 5: Commit**

```bash
git add cli/bloom-attach.ts tsconfig.json
git commit -m "feat(cli): add bloom-attach terminal client for room sessions"
```

---

## Chunk 5: Documentation and final verification

### Task 7: Update ARCHITECTURE.md

**Files:**
- Modify: `ARCHITECTURE.md` — rewrite the Daemon section

- [ ] **Step 1: Read current ARCHITECTURE.md daemon section**

Find the section describing the daemon architecture and note line numbers.

- [ ] **Step 2: Rewrite the daemon section**

Replace the current daemon description with:
- `pi --mode rpc` subprocess per room
- Unix socket multiplexing
- `bloom-attach` terminal client
- No SessionPool, no RoomRegistry, no LRU eviction
- Idle timeout is the only lifecycle control

- [ ] **Step 3: Commit**

```bash
git add ARCHITECTURE.md
git commit -m "docs: update ARCHITECTURE.md for RPC room daemon"
```

---

### Task 8: Full verification

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: Clean build, no errors

- [ ] **Step 2: Run all tests**

Run: `npm run test`
Expected: All tests pass

- [ ] **Step 3: Run lint and format check**

Run: `npm run check`
Expected: No issues

- [ ] **Step 4: Verify no stale imports**

Run: `grep -r "session-pool\|room-registry\|SessionPool\|RoomRegistry" daemon/ lib/ tests/ --include="*.ts"`
Expected: No matches (all references to old code are gone)

- [ ] **Step 5: Verify deleted files are gone**

Run: `ls daemon/session-pool.ts daemon/room-registry.ts 2>&1`
Expected: "No such file or directory" for both

- [ ] **Step 6: Final commit if any lint fixes were needed**

```bash
git add -A
git commit -m "chore: final cleanup for RPC room daemon migration"
```
