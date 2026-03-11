# Pi Daemon Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the PTY-hack `bloom-pi-agent.service` with a proper SDK-based daemon that manages one `AgentSession` per Matrix room, always running in parallel with the interactive terminal.

**Architecture:** A headless Node.js daemon (`daemon/index.ts`) uses Pi's `createAgentSession()` SDK to manage multiple sessions — one per Matrix room. Matrix rooms become the persistent organizational layer. The interactive terminal is independent and ephemeral. The daemon never stops for interactive sessions.

**Tech Stack:** Pi SDK (`createAgentSession`, `SessionManager`, `DefaultResourceLoader`), `matrix-bot-sdk` (already a dependency), systemd user service, TypeScript/ES2022/NodeNext.

**Spec:** `docs/superpowers/specs/2026-03-11-always-on-pi-daemon-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `daemon/index.ts` | Entry point — wires components, starts service, handles signals |
| `daemon/matrix-listener.ts` | Matrix bot-sdk client, room event routing |
| `daemon/session-pool.ts` | AgentSession lifecycle (create/resume/dispose), LRU eviction |
| `daemon/room-registry.ts` | `rooms.json` read/write, room-to-session mapping |
| `os/sysconfig/pi-daemon.service` | Systemd user service unit |
| `tests/daemon/room-registry.test.ts` | Room registry unit tests |
| `tests/daemon/session-pool.test.ts` | Session pool unit tests |
| `tests/daemon/matrix-listener.test.ts` | Matrix listener unit tests |

### Modified Files

| File | Change |
|------|--------|
| `lib/matrix.ts` | Add `registerMatrixAccount()` and helpers (moved from bloom-channels) |
| `extensions/bloom-persona/types.ts` | Remove `activeTopic` and `pendingChannels` from `BloomContext` |
| `extensions/bloom-persona/index.ts` | Remove topic scanning from `session_before_compact` |
| `extensions/bloom-persona/actions.ts` | Remove topic/channel lines from `buildRestoredContextBlock` |
| `os/sysconfig/bloom-bash_profile` | Remove daemon stop/start — just run `pi` |
| `extensions/bloom-setup/actions.ts` | Enable `pi-daemon.service` instead of `bloom-pi-agent.service` |
| `os/Containerfile` | Install `pi-daemon.service`, remove `bloom-pi-agent.service` |
| `tsconfig.json` | Add `daemon/**/*.ts` to include |
| `AGENTS.md` | Remove bloom-channels/topics, add pi-daemon |
| `CLAUDE.md` | Add `rooms.json` to key paths |

### Deleted Files

| File | Reason |
|------|--------|
| `extensions/bloom-channels/index.ts` | Retired — daemon replaces this |
| `extensions/bloom-channels/actions.ts` | Re-export file, no longer needed |
| `extensions/bloom-channels/matrix-client.ts` | Logic moves to daemon + lib/matrix.ts |
| `extensions/bloom-channels/types.ts` | No longer needed |
| `extensions/bloom-topics/index.ts` | Retired — rooms replace topics |
| `extensions/bloom-topics/actions.ts` | Retired |
| `extensions/bloom-topics/types.ts` | Retired |
| `tests/extensions/bloom-topics.test.ts` | Tests for retired extension |
| `tests/integration/topics-commands.test.ts` | Tests for retired extension |
| `os/sysconfig/bloom-pi-agent.service` | Replaced by pi-daemon.service |

### Modified Files (stale reference cleanup)

| File | Change |
|------|--------|
| `tests/e2e/extension-registration.test.ts` | Remove bloom-channels and bloom-topics describe blocks |
| `README.md` | Remove bloom-channels and bloom-topics from extension table |
| `docs/service-architecture.md` | Remove bloom-channels and bloom-topics references |
| `skills/recovery/SKILL.md` | Update Pi agent health check reference |

---

## Chunk 1: Cleanup — Retire bloom-topics, bloom-channels, update BloomContext

### Task 1: Remove bloom-topics extension

**Files:**
- Delete: `extensions/bloom-topics/index.ts`
- Delete: `extensions/bloom-topics/actions.ts`
- Delete: `extensions/bloom-topics/types.ts`
- Delete: `tests/extensions/bloom-topics.test.ts`
- Delete: `tests/integration/topics-commands.test.ts`
- Modify: `tests/e2e/extension-registration.test.ts` (remove bloom-topics describe block)

- [ ] **Step 1: Delete bloom-topics files and related tests**

```bash
git rm -r extensions/bloom-topics/
git rm tests/extensions/bloom-topics.test.ts tests/integration/topics-commands.test.ts
```

- [ ] **Step 2: Remove bloom-topics describe block from extension-registration.test.ts**

In `tests/e2e/extension-registration.test.ts`, delete the `bloom-topics registration` describe block (lines 161-173) and its import.

- [ ] **Step 3: Verify no remaining .ts imports**

```bash
grep -r "bloom-topics" extensions/ lib/ daemon/ tests/ --include="*.ts" -l
```

Expected: no results. (AGENTS.md, docs, README still reference it — handled in Task 12.)

- [ ] **Step 4: Run tests to verify nothing breaks**

Run: `npm run test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/extension-registration.test.ts
git commit -m "chore: retire bloom-topics extension — rooms replace topics"
```

---

### Task 2: Move registerMatrixAccount to lib/matrix.ts and remove bloom-channels

**Files:**
- Modify: `lib/matrix.ts` (add `registerMatrixAccount`, `registerStep2`, `parseRegistrationError`)
- Delete: `extensions/bloom-channels/index.ts`
- Delete: `extensions/bloom-channels/actions.ts`
- Delete: `extensions/bloom-channels/matrix-client.ts`
- Delete: `extensions/bloom-channels/types.ts`
- Test: `tests/lib/matrix.test.ts` (add tests for registerMatrixAccount)

- [ ] **Step 1: Write failing test for registerMatrixAccount**

Create `tests/lib/matrix-registration.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock global fetch before importing
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { registerMatrixAccount } from "../../lib/matrix.js";

describe("registerMatrixAccount", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("registers successfully on direct 200 (no UIA)", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: async () => ({ user_id: "@test:bloom", access_token: "tok123" }),
		});

		const result = await registerMatrixAccount("http://localhost:6167", "test", "pass", "token");
		expect(result).toEqual({ ok: true, userId: "@test:bloom", accessToken: "tok123" });
	});

	it("handles UIA 401 flow with registration token", async () => {
		// Step 1: 401 with session
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 401,
			json: async () => ({ session: "sess123" }),
		});
		// Step 2: success
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: async () => ({ user_id: "@test:bloom", access_token: "tok456" }),
		});

		const result = await registerMatrixAccount("http://localhost:6167", "test", "pass", "token");
		expect(result).toEqual({ ok: true, userId: "@test:bloom", accessToken: "tok456" });
	});

	it("returns error for M_USER_IN_USE", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 400,
			json: async () => ({ errcode: "M_USER_IN_USE", error: "User ID already taken" }),
		});

		const result = await registerMatrixAccount("http://localhost:6167", "test", "pass", "token");
		expect(result).toEqual({ ok: false, error: "Username is already taken." });
	});

	it("returns error when 401 has no session", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 401,
			json: async () => ({}),
		});

		const result = await registerMatrixAccount("http://localhost:6167", "test", "pass", "token");
		expect(result).toEqual({ ok: false, error: "No session ID in 401 response" });
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/matrix-registration.test.ts`
Expected: FAIL — `registerMatrixAccount` is not exported from `lib/matrix.ts`.

- [ ] **Step 3: Add registerMatrixAccount to lib/matrix.ts**

Append to `lib/matrix.ts`:

```typescript
/**
 * Register a new Matrix account via the UIA (User-Interactive Authentication) flow.
 * Uses a registration token to authorize the account creation.
 *
 * @param homeserver - Base URL of the Matrix homeserver
 * @param username - Desired localpart (no @domain)
 * @param password - Account password
 * @param registrationToken - Token permitting registration on this homeserver
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
		return parseRegistrationError(await step1.json(), step1.status);
	}

	const step1Body = (await step1.json()) as { session?: string };
	const session = step1Body.session;
	if (!session) return { ok: false, error: "No session ID in 401 response" };

	return registerStep2(url, username, password, registrationToken, session);
}

async function registerStep2(
	url: string,
	username: string,
	password: string,
	registrationToken: string,
	session: string,
): Promise<{ ok: true; userId: string; accessToken: string } | { ok: false; error: string }> {
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

	if (step2.status === 401) return { ok: false, error: "Invalid registration token" };
	return parseRegistrationError(await step2.json(), step2.status);
}

function parseRegistrationError(err: unknown, status: number): { ok: false; error: string } {
	const e = err as { errcode?: string; error?: string };
	if (e.errcode === "M_USER_IN_USE") return { ok: false, error: "Username is already taken." };
	return { ok: false, error: e.error ?? `Registration failed (${status})` };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/matrix-registration.test.ts`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Remove bloom-channels describe block from extension-registration.test.ts**

In `tests/e2e/extension-registration.test.ts`, delete the `bloom-channels registration` describe block (lines 43-55) and its import.

Note: `registerMatrixAccount` has no external callers outside bloom-channels itself. It is being relocated for future use by the daemon.

- [ ] **Step 6: Delete bloom-channels extension**

```bash
git rm -r extensions/bloom-channels/
```

- [ ] **Step 7: Run full test suite**

Run: `npm run test`
Expected: all tests pass.

- [ ] **Step 8: Run lint**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add lib/matrix.ts tests/lib/matrix-registration.test.ts tests/e2e/extension-registration.test.ts
git commit -m "refactor: move registerMatrixAccount to lib/matrix.ts, retire bloom-channels"
```

---

### Task 3: Remove activeTopic and pendingChannels from BloomContext

**Files:**
- Modify: `extensions/bloom-persona/types.ts`
- Modify: `extensions/bloom-persona/index.ts`
- Modify: `extensions/bloom-persona/actions.ts`
- Test: `tests/extensions/bloom-persona.test.ts` (verify existing tests still pass)

- [ ] **Step 1: Update BloomContext type**

In `extensions/bloom-persona/types.ts`, change:

```typescript
/** Persisted context state for cross-compaction continuity. */
export interface BloomContext {
	savedAt: string;
	activeTopic?: string;
	pendingChannels: number;
	updateAvailable: boolean;
}
```

To:

```typescript
/** Persisted context state for cross-compaction continuity. */
export interface BloomContext {
	savedAt: string;
	updateAvailable: boolean;
}
```

- [ ] **Step 2: Update session_before_compact in index.ts**

In `extensions/bloom-persona/index.ts`, replace the `session_before_compact` handler (lines 68-99):

```typescript
	pi.on("session_before_compact", async (event) => {
		const { firstKeptEntryId, tokensBefore } = event.preparation;

		const updateAvailable = checkUpdateAvailable();

		saveContext({
			savedAt: new Date().toISOString(),
			updateAvailable,
		});

		const summary = [
			"COMPACTION GUIDANCE — preserve the following across summarization:",
			"1. Bloom persona identity: values, voice, growth stage, and boundaries.",
			"2. Human context: name, preferences, recurring topics, and active projects.",
			"3. Task state: in-progress tasks, open threads, and decisions pending.",
			`Tokens before compaction: ${tokensBefore}.`,
		].join("\n");
		return {
			compaction: { summary, firstKeptEntryId, tokensBefore },
		};
	});
```

- [ ] **Step 3: Update buildRestoredContextBlock in actions.ts**

In `extensions/bloom-persona/actions.ts`, replace `buildRestoredContextBlock`:

```typescript
/** Build the restored-context system prompt block from persisted compaction state. */
export function buildRestoredContextBlock(ctx: BloomContext): string {
	const lines = ["\n\n[RESTORED CONTEXT]"];
	if (ctx.updateAvailable) lines.push("OS update available — inform user if not already done.");
	lines.push(`Context saved at: ${ctx.savedAt}`);
	return lines.join("\n");
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test`
Expected: all tests pass. Existing `bloom-context.json` files with the old fields are handled gracefully (JSON.parse ignores extra keys).

- [ ] **Step 5: Run lint**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add extensions/bloom-persona/types.ts extensions/bloom-persona/index.ts extensions/bloom-persona/actions.ts
git commit -m "chore: remove activeTopic and pendingChannels from BloomContext"
```

---

## Chunk 2: Core Daemon — room-registry, session-pool, matrix-listener, index

### Task 4: Add daemon/ to tsconfig.json

**Files:**
- Modify: `tsconfig.json`

- [ ] **Step 1: Add daemon to include**

In `tsconfig.json`, change the `include` array from:

```json
"include": ["extensions/**/*.ts", "lib/**/*.ts", "tests/**/*.ts"]
```

To:

```json
"include": ["extensions/**/*.ts", "lib/**/*.ts", "daemon/**/*.ts", "tests/**/*.ts"]
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: succeeds (daemon/ is empty but included — no error).

- [ ] **Step 3: Commit**

```bash
git add tsconfig.json
git commit -m "chore: add daemon/ to tsconfig include paths"
```

---

### Task 5: Implement room-registry.ts

**Files:**
- Create: `daemon/room-registry.ts`
- Create: `tests/daemon/room-registry.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/daemon/room-registry.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RoomRegistry, type RoomEntry } from "../../daemon/room-registry.js";

describe("RoomRegistry", () => {
	let dir: string;
	let registryPath: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "room-registry-"));
		registryPath = join(dir, "rooms.json");
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("creates empty registry if file does not exist", () => {
		const reg = new RoomRegistry(registryPath);
		expect(reg.getAll()).toEqual({});
	});

	it("loads existing registry from disk", () => {
		const data: Record<string, RoomEntry> = {
			"!abc:bloom": {
				roomAlias: "#general:bloom",
				sessionPath: "/home/pi/.pi/agent/sessions/bloom-rooms/session.jsonl",
				created: "2026-03-11T15:00:00Z",
				lastActive: "2026-03-11T16:00:00Z",
				archived: false,
			},
		};
		writeFileSync(registryPath, JSON.stringify(data));
		const reg = new RoomRegistry(registryPath);
		expect(reg.get("!abc:bloom")).toEqual(data["!abc:bloom"]);
	});

	it("sets and persists a room entry", () => {
		const reg = new RoomRegistry(registryPath);
		const entry: RoomEntry = {
			roomAlias: "#test:bloom",
			sessionPath: "/tmp/session.jsonl",
			created: "2026-03-11T15:00:00Z",
			lastActive: "2026-03-11T15:00:00Z",
			archived: false,
		};
		reg.set("!xyz:bloom", entry);

		// Verify in-memory
		expect(reg.get("!xyz:bloom")).toEqual(entry);

		// Verify on disk
		const diskData = JSON.parse(readFileSync(registryPath, "utf-8"));
		expect(diskData["!xyz:bloom"]).toEqual(entry);
	});

	it("updates lastActive on touch", () => {
		const reg = new RoomRegistry(registryPath);
		reg.set("!abc:bloom", {
			roomAlias: "#general:bloom",
			sessionPath: "/tmp/s.jsonl",
			created: "2026-03-11T15:00:00Z",
			lastActive: "2026-03-11T15:00:00Z",
			archived: false,
		});

		reg.touch("!abc:bloom");
		const entry = reg.get("!abc:bloom");
		expect(entry).toBeDefined();
		expect(entry!.lastActive).not.toBe("2026-03-11T15:00:00Z");
	});

	it("returns undefined for unknown room", () => {
		const reg = new RoomRegistry(registryPath);
		expect(reg.get("!unknown:bloom")).toBeUndefined();
	});

	it("finds least recently used room", () => {
		const reg = new RoomRegistry(registryPath);
		reg.set("!a:bloom", {
			roomAlias: "#a:bloom",
			sessionPath: "/tmp/a.jsonl",
			created: "2026-03-11T15:00:00Z",
			lastActive: "2026-03-11T15:00:00Z",
			archived: false,
		});
		reg.set("!b:bloom", {
			roomAlias: "#b:bloom",
			sessionPath: "/tmp/b.jsonl",
			created: "2026-03-11T16:00:00Z",
			lastActive: "2026-03-11T16:00:00Z",
			archived: false,
		});

		expect(reg.leastRecentlyUsed()).toBe("!a:bloom");
	});

	it("archives a room", () => {
		const reg = new RoomRegistry(registryPath);
		reg.set("!a:bloom", {
			roomAlias: "#a:bloom",
			sessionPath: "/tmp/a.jsonl",
			created: "2026-03-11T15:00:00Z",
			lastActive: "2026-03-11T15:00:00Z",
			archived: false,
		});

		reg.archive("!a:bloom");
		expect(reg.get("!a:bloom")!.archived).toBe(true);
	});

	it("excludes archived rooms from LRU", () => {
		const reg = new RoomRegistry(registryPath);
		reg.set("!a:bloom", {
			roomAlias: "#a:bloom",
			sessionPath: "/tmp/a.jsonl",
			created: "2026-03-11T15:00:00Z",
			lastActive: "2026-03-11T15:00:00Z",
			archived: false,
		});
		reg.set("!b:bloom", {
			roomAlias: "#b:bloom",
			sessionPath: "/tmp/b.jsonl",
			created: "2026-03-11T16:00:00Z",
			lastActive: "2026-03-11T16:00:00Z",
			archived: false,
		});
		reg.archive("!a:bloom");

		expect(reg.leastRecentlyUsed()).toBe("!b:bloom");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/daemon/room-registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement room-registry.ts**

Create `daemon/room-registry.ts`:

```typescript
/**
 * Room registry — maps Matrix room IDs to session file paths.
 * Persists to ~/.pi/pi-daemon/rooms.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createLogger } from "../lib/shared.js";

const log = createLogger("room-registry");

export interface RoomEntry {
	roomAlias: string;
	sessionPath: string;
	created: string;
	lastActive: string;
	archived: boolean;
}

export class RoomRegistry {
	private rooms: Record<string, RoomEntry> = {};
	private readonly path: string;

	constructor(path: string) {
		this.path = path;
		this.load();
	}

	private load(): void {
		if (!existsSync(this.path)) {
			log.info("no rooms.json found, starting fresh", { path: this.path });
			return;
		}
		try {
			this.rooms = JSON.parse(readFileSync(this.path, "utf-8")) as Record<string, RoomEntry>;
			log.info("loaded room registry", { count: Object.keys(this.rooms).length });
		} catch (err) {
			log.error("failed to parse rooms.json, starting fresh", { error: String(err) });
			this.rooms = {};
		}
	}

	private flush(): void {
		const dir = dirname(this.path);
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		writeFileSync(this.path, JSON.stringify(this.rooms, null, "\t") + "\n");
	}

	get(roomId: string): RoomEntry | undefined {
		return this.rooms[roomId];
	}

	getAll(): Record<string, RoomEntry> {
		return { ...this.rooms };
	}

	set(roomId: string, entry: RoomEntry): void {
		this.rooms[roomId] = entry;
		this.flush();
	}

	touch(roomId: string): void {
		const entry = this.rooms[roomId];
		if (!entry) return;
		entry.lastActive = new Date().toISOString();
		this.flush();
	}

	archive(roomId: string): void {
		const entry = this.rooms[roomId];
		if (!entry) return;
		entry.archived = true;
		this.flush();
	}

	/** Find the non-archived room with the oldest lastActive timestamp. */
	leastRecentlyUsed(): string | undefined {
		let oldest: string | undefined;
		let oldestTime = Number.POSITIVE_INFINITY;
		for (const [roomId, entry] of Object.entries(this.rooms)) {
			if (entry.archived) continue;
			const t = new Date(entry.lastActive).getTime();
			if (t < oldestTime) {
				oldestTime = t;
				oldest = roomId;
			}
		}
		return oldest;
	}

	/** Flush to disk (for graceful shutdown). */
	flushSync(): void {
		this.flush();
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/daemon/room-registry.test.ts`
Expected: PASS (all 8 tests).

- [ ] **Step 5: Run lint**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add daemon/room-registry.ts tests/daemon/room-registry.test.ts
git commit -m "feat: add room-registry — room-to-session mapping for pi-daemon"
```

---

### Task 6: Implement session-pool.ts

**Files:**
- Create: `daemon/session-pool.ts`
- Create: `tests/daemon/session-pool.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/daemon/session-pool.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionPool } from "../../daemon/session-pool.js";
import { RoomRegistry } from "../../daemon/room-registry.js";

// Mock createAgentSession — we can't actually create real sessions in unit tests
vi.mock("@mariozechner/pi-coding-agent", () => ({
	createAgentSession: vi.fn().mockResolvedValue({
		session: {
			sessionFile: "/tmp/mock-session.jsonl",
			dispose: vi.fn(),
			subscribe: vi.fn().mockReturnValue(() => {}),
			prompt: vi.fn().mockResolvedValue(undefined),
		},
		extensionsResult: { extensions: [], diagnostics: [] },
	}),
	SessionManager: {
		create: vi.fn().mockReturnValue({}),
		open: vi.fn().mockReturnValue({}),
	},
	DefaultResourceLoader: vi.fn().mockImplementation(() => ({
		reload: vi.fn().mockResolvedValue(undefined),
	})),
}));

describe("SessionPool", () => {
	let dir: string;
	let registry: RoomRegistry;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "session-pool-"));
		registry = new RoomRegistry(join(dir, "rooms.json"));
		vi.clearAllMocks();
	});

	it("creates a new session for an unknown room", async () => {
		const pool = new SessionPool({
			registry,
			maxSessions: 3,
			idleTimeoutMs: 15 * 60 * 1000,
			sessionDir: join(dir, "sessions"),
			extensionFactories: [],
		});

		const session = await pool.getOrCreate("!abc:bloom", "#general:bloom");
		expect(session).toBeDefined();
		expect(session.prompt).toBeDefined();
		expect(registry.get("!abc:bloom")).toBeDefined();
	});

	it("returns the same session for the same room", async () => {
		const pool = new SessionPool({
			registry,
			maxSessions: 3,
			idleTimeoutMs: 15 * 60 * 1000,
			sessionDir: join(dir, "sessions"),
			extensionFactories: [],
		});

		const s1 = await pool.getOrCreate("!abc:bloom", "#general:bloom");
		const s2 = await pool.getOrCreate("!abc:bloom", "#general:bloom");
		expect(s1).toBe(s2);
	});

	it("evicts LRU session when max reached", async () => {
		const pool = new SessionPool({
			registry,
			maxSessions: 2,
			idleTimeoutMs: 15 * 60 * 1000,
			sessionDir: join(dir, "sessions"),
			extensionFactories: [],
		});

		await pool.getOrCreate("!a:bloom", "#a:bloom");
		await pool.getOrCreate("!b:bloom", "#b:bloom");
		await pool.getOrCreate("!c:bloom", "#c:bloom");

		expect(pool.loadedCount()).toBe(2);
	});

	it("disposes all sessions on shutdown", async () => {
		const pool = new SessionPool({
			registry,
			maxSessions: 3,
			idleTimeoutMs: 15 * 60 * 1000,
			sessionDir: join(dir, "sessions"),
			extensionFactories: [],
		});

		await pool.getOrCreate("!abc:bloom", "#general:bloom");
		await pool.disposeAll();
		expect(pool.loadedCount()).toBe(0);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/daemon/session-pool.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement session-pool.ts**

Create `daemon/session-pool.ts`:

```typescript
/**
 * Session pool — manages AgentSession lifecycle for Matrix rooms.
 * Creates, resumes, and disposes sessions with LRU eviction.
 */
import os from "node:os";
import { join } from "node:path";
import { mkdirSync, existsSync, renameSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
	createAgentSession,
	SessionManager,
	DefaultResourceLoader,
	type AgentSession,
	type ExtensionFactory,
	type AgentSessionEvent,
} from "@mariozechner/pi-coding-agent";
import type { RoomRegistry } from "./room-registry.js";
import { createLogger } from "../lib/shared.js";

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

	/** Get or create a session for a room. Creates new if needed, resumes if exists on disk. */
	async getOrCreate(roomId: string, roomAlias: string): Promise<AgentSession> {
		const existing = this.loaded.get(roomId);
		if (existing) {
			this.options.registry.touch(roomId);
			this.resetIdleTimer(roomId);
			return existing;
		}

		// Evict LRU if at capacity
		if (this.loaded.size >= this.options.maxSessions) {
			this.evictLRU();
		}

		const entry = this.options.registry.get(roomId);
		const sessionDir = this.options.sessionDir;
		if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });

		let sessionManager: InstanceType<typeof SessionManager>;
		if (entry?.sessionPath && existsSync(entry.sessionPath)) {
			try {
				sessionManager = SessionManager.open(entry.sessionPath, sessionDir);
				log.info("resuming session", { roomId, path: entry.sessionPath });
			} catch (err) {
				// Corrupted session file — archive it and create fresh
				log.warn("corrupted session file, creating fresh", { roomId, path: entry.sessionPath, error: String(err) });
				const corruptPath = `${entry.sessionPath}.corrupt.${Date.now()}`;
				try {
					renameSync(entry.sessionPath, corruptPath);
				} catch { /* best effort */ }
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
			archived: false,
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
			if (!entry || entry.archived) continue;
			const t = new Date(entry.lastActive).getTime();
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/daemon/session-pool.test.ts`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Run lint**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add daemon/session-pool.ts tests/daemon/session-pool.test.ts
git commit -m "feat: add session-pool — LRU session management for pi-daemon"
```

---

### Task 7: Implement matrix-listener.ts

**Files:**
- Create: `daemon/matrix-listener.ts`
- Create: `tests/daemon/matrix-listener.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/daemon/matrix-listener.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock matrix-bot-sdk
const mockStart = vi.fn().mockResolvedValue(undefined);
const mockStop = vi.fn();
const mockGetUserId = vi.fn().mockResolvedValue("@pi:bloom");
const mockSendText = vi.fn().mockResolvedValue("$event1");
const mockOn = vi.fn();
const mockGetJoinedRooms = vi.fn().mockResolvedValue([]);

vi.mock("matrix-bot-sdk", () => ({
	MatrixClient: vi.fn().mockImplementation(() => ({
		start: mockStart,
		stop: mockStop,
		getUserId: mockGetUserId,
		sendText: mockSendText,
		on: mockOn,
		getJoinedRooms: mockGetJoinedRooms,
	})),
	SimpleFsStorageProvider: vi.fn().mockImplementation(() => ({})),
	AutojoinRoomsMixin: { setupOnClient: vi.fn() },
}));

import { MatrixListener } from "../../daemon/matrix-listener.js";

describe("MatrixListener", () => {
	let dir: string;
	let credsPath: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "matrix-listener-"));
		credsPath = join(dir, "credentials.json");
		writeFileSync(
			credsPath,
			JSON.stringify({
				homeserver: "http://localhost:6167",
				botUserId: "@pi:bloom",
				botAccessToken: "tok123",
				botPassword: "pass",
				registrationToken: "reg-token",
			}),
		);
		vi.clearAllMocks();
	});

	it("starts and connects to Matrix", async () => {
		const listener = new MatrixListener({
			credentialsPath: credsPath,
			storagePath: join(dir, "state.json"),
			onMessage: vi.fn(),
		});

		await listener.start();
		expect(mockStart).toHaveBeenCalled();
	});

	it("stops cleanly", async () => {
		const listener = new MatrixListener({
			credentialsPath: credsPath,
			storagePath: join(dir, "state.json"),
			onMessage: vi.fn(),
		});

		await listener.start();
		listener.stop();
		expect(mockStop).toHaveBeenCalled();
	});

	it("sends text to a room", async () => {
		const listener = new MatrixListener({
			credentialsPath: credsPath,
			storagePath: join(dir, "state.json"),
			onMessage: vi.fn(),
		});

		await listener.start();
		await listener.sendText("!abc:bloom", "Hello");
		expect(mockSendText).toHaveBeenCalledWith("!abc:bloom", "Hello");
	});

	it("calls onMessage when room.message fires", async () => {
		const onMessage = vi.fn();
		const listener = new MatrixListener({
			credentialsPath: credsPath,
			storagePath: join(dir, "state.json"),
			onMessage,
		});

		await listener.start();

		// Get the room.message handler that was registered
		const roomMessageCall = mockOn.mock.calls.find((c) => c[0] === "room.message");
		expect(roomMessageCall).toBeDefined();

		const handler = roomMessageCall![1] as (roomId: string, event: Record<string, unknown>) => void;

		// Simulate incoming message (not from bot)
		handler("!abc:bloom", {
			sender: "@user:bloom",
			content: { msgtype: "m.text", body: "Hello Pi" },
			event_id: "$evt1",
		});

		// Wait for async handler
		await new Promise((r) => setTimeout(r, 10));

		expect(onMessage).toHaveBeenCalledWith(
			"!abc:bloom",
			expect.objectContaining({ sender: "@user:bloom", body: "Hello Pi" }),
		);
	});

	it("ignores messages from the bot itself", async () => {
		const onMessage = vi.fn();
		const listener = new MatrixListener({
			credentialsPath: credsPath,
			storagePath: join(dir, "state.json"),
			onMessage,
		});

		await listener.start();

		const roomMessageCall = mockOn.mock.calls.find((c) => c[0] === "room.message");
		const handler = roomMessageCall![1] as (roomId: string, event: Record<string, unknown>) => void;

		// Message from the bot itself
		handler("!abc:bloom", {
			sender: "@pi:bloom",
			content: { msgtype: "m.text", body: "I said something" },
			event_id: "$evt2",
		});

		await new Promise((r) => setTimeout(r, 10));

		expect(onMessage).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/daemon/matrix-listener.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement matrix-listener.ts**

Create `daemon/matrix-listener.ts`:

```typescript
/**
 * Matrix listener — connects to homeserver via matrix-bot-sdk and routes messages.
 */
import { readFileSync } from "node:fs";
import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { MatrixClient, SimpleFsStorageProvider, AutojoinRoomsMixin } from "matrix-bot-sdk";
import type { MatrixCredentials } from "../lib/matrix.js";
import { createLogger } from "../lib/shared.js";

const log = createLogger("matrix-listener");

export interface IncomingMessage {
	sender: string;
	body: string;
	eventId: string;
}

export interface MatrixListenerOptions {
	credentialsPath: string;
	storagePath: string;
	onMessage: (roomId: string, message: IncomingMessage) => void;
}

export class MatrixListener {
	private client: MatrixClient | null = null;
	private botUserId: string | null = null;
	private readonly options: MatrixListenerOptions;

	constructor(options: MatrixListenerOptions) {
		this.options = options;
	}

	async start(): Promise<void> {
		const creds = this.loadCredentials();
		if (!creds) {
			throw new Error(`No credentials at ${this.options.credentialsPath}`);
		}

		const storageDir = dirname(this.options.storagePath);
		if (!existsSync(storageDir)) mkdirSync(storageDir, { recursive: true });

		const storage = new SimpleFsStorageProvider(this.options.storagePath);
		this.client = new MatrixClient(creds.homeserver, creds.botAccessToken, storage);
		this.botUserId = creds.botUserId;

		AutojoinRoomsMixin.setupOnClient(this.client);
		this.client.on("room.message", (roomId: string, event: Record<string, unknown>) => {
			void this.handleEvent(roomId, event);
		});

		await this.client.start();
		log.info("connected to Matrix", { userId: this.botUserId, homeserver: creds.homeserver });
	}

	stop(): void {
		if (this.client) {
			this.client.stop();
			log.info("disconnected from Matrix");
			this.client = null;
		}
	}

	async sendText(roomId: string, text: string): Promise<void> {
		if (!this.client) throw new Error("Matrix client not started");
		await this.client.sendText(roomId, text);
	}

	async getRoomAlias(roomId: string): Promise<string> {
		if (!this.client) return roomId;
		try {
			const aliases = await this.client.getPublishedAlias(roomId);
			return aliases ?? roomId;
		} catch {
			return roomId;
		}
	}

	private loadCredentials(): MatrixCredentials | null {
		try {
			return JSON.parse(readFileSync(this.options.credentialsPath, "utf-8")) as MatrixCredentials;
		} catch {
			return null;
		}
	}

	private async handleEvent(roomId: string, event: Record<string, unknown>): Promise<void> {
		const sender = event.sender as string | undefined;
		if (!sender || sender === this.botUserId) return;

		const content = event.content as Record<string, unknown> | undefined;
		if (!content || content.msgtype !== "m.text") return;

		const body = content.body as string | undefined;
		if (!body) return;

		const eventId = (event.event_id as string | undefined) ?? "unknown";

		log.info("received message", { roomId, sender, eventId });

		this.options.onMessage(roomId, { sender, body, eventId });
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/daemon/matrix-listener.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Run lint**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add daemon/matrix-listener.ts tests/daemon/matrix-listener.test.ts
git commit -m "feat: add matrix-listener — Matrix event routing for pi-daemon"
```

---

### Task 8: Implement daemon/index.ts (entry point)

**Files:**
- Create: `daemon/index.ts`

- [ ] **Step 1: Implement daemon entry point**

Create `daemon/index.ts`:

```typescript
/**
 * Pi Daemon — always-on Matrix room agent.
 *
 * Entry point: wires MatrixListener, SessionPool, and RoomRegistry,
 * then listens for Matrix messages and routes them to per-room AgentSessions.
 */
import os from "node:os";
import { join } from "node:path";
import type { ExtensionFactory, AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import { RoomRegistry } from "./room-registry.js";
import { SessionPool } from "./session-pool.js";
import { MatrixListener, type IncomingMessage } from "./matrix-listener.js";
import { createLogger } from "../lib/shared.js";
import { extractResponseText, matrixCredentialsPath } from "../lib/matrix.js";

const log = createLogger("pi-daemon");

const MAX_SESSIONS = Number.parseInt(process.env.BLOOM_DAEMON_MAX_SESSIONS ?? "3", 10);
const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const REGISTRY_PATH = join(os.homedir(), ".pi", "pi-daemon", "rooms.json");
const SESSION_DIR = join(os.homedir(), ".pi", "agent", "sessions", "bloom-rooms");
const STORAGE_PATH = join(os.homedir(), ".pi", "pi-daemon", "matrix-state.json");
const GENERAL_ROOM_ALIAS = "#general:bloom";

/** Build extension factories for daemon sessions. */
function buildExtensionFactories(): ExtensionFactory[] {
	// Daemon sessions load Bloom extensions via the Pi package system.
	// The bloom-rooms inline extension adds room management tools.
	const bloomRoomsFactory: ExtensionFactory = (pi) => {
		// Room tools will be registered here in a future iteration.
		// For now, the daemon uses the standard Bloom extension set.
		log.info("bloom-rooms extension loaded");
	};

	return [bloomRoomsFactory];
}

async function main(): Promise<void> {
	log.info("starting pi-daemon", { maxSessions: MAX_SESSIONS, idleTimeoutMs: IDLE_TIMEOUT_MS });

	const registry = new RoomRegistry(REGISTRY_PATH);
	const extensionFactories = buildExtensionFactories();

	const pool = new SessionPool({
		registry,
		maxSessions: MAX_SESSIONS,
		idleTimeoutMs: IDLE_TIMEOUT_MS,
		sessionDir: SESSION_DIR,
		extensionFactories,
	});

	const listener = new MatrixListener({
		credentialsPath: matrixCredentialsPath(),
		storagePath: STORAGE_PATH,
		onMessage: (roomId, message) => {
			void handleMessage(roomId, message);
		},
	});

	// Track API key state — stop prompting if key is bad
	let apiKeyDisabled = false;

	// Forward session events to Matrix rooms
	pool.onEvent(async (roomId, event: AgentSessionEvent) => {
		if ("type" in event && event.type === "agent_end" && "messages" in event) {
			const text = extractResponseText((event as { messages: readonly unknown[] }).messages);
			if (text) {
				try {
					await listener.sendText(roomId, text);
				} catch (err) {
					log.error("failed to send response to Matrix", { roomId, error: String(err) });
				}
			}
		}
	});

	async function handleMessage(roomId: string, message: IncomingMessage): Promise<void> {
		if (apiKeyDisabled) {
			log.warn("ignoring message — API key disabled", { roomId });
			return;
		}

		try {
			const alias = await listener.getRoomAlias(roomId);
			const session = await pool.getOrCreate(roomId, alias);

			log.info("routing message to session", { roomId, sender: message.sender });
			await session.prompt(`[matrix: ${message.sender}] ${message.body}`);
		} catch (err) {
			const errStr = String(err);
			log.error("failed to handle message", { roomId, error: errStr });

			// Detect API key errors — stop prompting and notify #general
			if (errStr.includes("401") || errStr.includes("invalid_api_key") || errStr.includes("authentication")) {
				apiKeyDisabled = true;
				log.error("API key error detected, disabling prompting");
				try {
					// Best-effort notification to general room
					await listener.sendText(roomId, "My API key needs attention. I'll stop responding until it's fixed.");
				} catch { /* best effort */ }
				return;
			}

			try {
				await listener.sendText(roomId, `Sorry, I hit an error: ${errStr}`);
			} catch {
				// Best-effort error notification
			}
		}
	}

	// Graceful shutdown
	function shutdown(signal: string): void {
		log.info("shutting down", { signal });
		listener.stop();
		pool.disposeAll();
		registry.flushSync();
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

- [ ] **Step 2: Build to verify it compiles**

Run: `npm run build`
Expected: compiles without errors.

- [ ] **Step 3: Run lint**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add daemon/index.ts
git commit -m "feat: add pi-daemon entry point — wires Matrix listener, session pool, and room registry"
```

---

## Chunk 3: OS Integration, Documentation, Final Cleanup

### Task 9: Create pi-daemon.service and update Containerfile

**Files:**
- Create: `os/sysconfig/pi-daemon.service`
- Delete: `os/sysconfig/bloom-pi-agent.service`
- Modify: `os/Containerfile`

- [ ] **Step 1: Create pi-daemon.service**

Create `os/sysconfig/pi-daemon.service`:

```ini
[Unit]
Description=Bloom Pi Daemon (Matrix room agent)
After=network-online.target bloom-matrix.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/node /usr/local/share/bloom/dist/daemon/index.js
Environment=HOME=%h
Environment=BLOOM_DIR=%h/Bloom
Restart=on-failure
RestartSec=15
ConditionPathExists=%h/.bloom/.setup-complete

[Install]
WantedBy=default.target
```

- [ ] **Step 2: Delete bloom-pi-agent.service**

```bash
rm os/sysconfig/bloom-pi-agent.service
```

- [ ] **Step 3: Update Containerfile**

In `os/Containerfile`, replace:

```dockerfile
# Persistent Pi agent service — listens on Matrix when no interactive session is active
# Installed as a user service template; enabled after first-boot setup completes
COPY os/sysconfig/bloom-pi-agent.service /usr/lib/systemd/user/bloom-pi-agent.service
```

With:

```dockerfile
# Pi daemon — always-on Matrix room agent (SDK-based, one session per room)
# Enabled after first-boot setup completes via bloom-setup
COPY os/sysconfig/pi-daemon.service /usr/lib/systemd/user/pi-daemon.service
```

- [ ] **Step 4: Commit**

```bash
git add os/sysconfig/pi-daemon.service
git add -A os/sysconfig/bloom-pi-agent.service
git add os/Containerfile
git commit -m "feat: replace bloom-pi-agent.service with pi-daemon.service"
```

---

### Task 10: Simplify bloom-bash_profile

**Files:**
- Modify: `os/sysconfig/bloom-bash_profile`

- [ ] **Step 1: Update bash_profile**

Replace the entire contents of `os/sysconfig/bloom-bash_profile` with:

```bash
# Source .bashrc for env vars (BLOOM_DIR, PATH, etc.)
[ -f ~/.bashrc ] && . ~/.bashrc

# Start Pi on interactive login (only one instance — atomic mkdir lock)
# The pi-daemon runs independently via systemd — no stop/start needed.
if [ -t 0 ] && [ -z "$PI_SESSION" ] && mkdir /tmp/.bloom-pi-session 2>/dev/null; then
  trap 'rmdir /tmp/.bloom-pi-session 2>/dev/null' EXIT
  export PI_SESSION=1
  /usr/local/bin/bloom-greeting.sh
  exec pi
fi
```

- [ ] **Step 2: Commit**

```bash
git add os/sysconfig/bloom-bash_profile
git commit -m "chore: simplify bash_profile — daemon runs independently, no stop/start"
```

---

### Task 11: Update bloom-setup to enable pi-daemon.service

**Files:**
- Modify: `extensions/bloom-setup/actions.ts`

- [ ] **Step 1: Update touchSetupComplete**

In `extensions/bloom-setup/actions.ts`, find `touchSetupComplete` and change `bloom-pi-agent.service` to `pi-daemon.service`:

```typescript
export async function touchSetupComplete(): Promise<void> {
	const dir = dirname(SETUP_COMPLETE_PATH);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
	writeFileSync(SETUP_COMPLETE_PATH, new Date().toISOString(), "utf-8");

	const user = os.userInfo().username;
	await run("loginctl", ["enable-linger", user]);
	await run("systemctl", ["--user", "enable", "--now", "pi-daemon.service"]);
	log.info("enabled pi-daemon.service and linger for persistent Matrix listening");
}
```

Note the addition of `--now` to both enable AND start the daemon immediately after setup completes.

Note: The spec also mentions creating the Bloom Matrix space and `#general:bloom` room in `touchSetupComplete()`. This is deferred to a follow-up task — the daemon handles room creation on first message, and the first-boot setup already creates `#general:bloom` during the matrix step.

- [ ] **Step 2: Run tests**

Run: `npm run test`
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add extensions/bloom-setup/actions.ts
git commit -m "chore: setup enables pi-daemon.service instead of bloom-pi-agent"
```

---

### Task 12: Update AGENTS.md and CLAUDE.md

**Files:**
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update AGENTS.md**

Remove the `bloom-channels` and `bloom-topics` extension sections (including their tools/commands/hooks). Update the Mermaid sequence diagrams to remove `bloom-channels connects to Matrix` and `bloom-topics injects topic guidance` annotations. Add a `pi-daemon` section under OS-level infrastructure. Add `rooms.json` to key paths.

Specific changes:
1. Remove the `### 📡 bloom-channels` section entirely
2. Remove the `### 🗂️ bloom-topics` section entirely
3. In the `session_start` sequence diagram Note, remove `bloom-channels connects to Matrix`
4. In the `before_agent_start` sequence diagram Note, remove `bloom-topics injects topic guidance`
5. Add a pi-daemon infrastructure section (below)

```markdown
### Pi Daemon (pi-daemon.service)

Always-on SDK-based daemon managing one `AgentSession` per Matrix room. Runs as a systemd user service after first-boot setup. The daemon and interactive terminal run in parallel — they share filesystem and persona but not sessions.

**Components:**
- `daemon/index.ts` — entry point, wires components
- `daemon/matrix-listener.ts` — Matrix bot-sdk client
- `daemon/session-pool.ts` — session lifecycle, LRU eviction (max 3 default)
- `daemon/room-registry.ts` — `rooms.json` room-to-session mapping

**Key paths:**
- `~/.pi/pi-daemon/rooms.json` — room registry
- `~/.pi/agent/sessions/bloom-rooms/` — daemon session files
- `~/.pi/pi-daemon/matrix-state.json` — Matrix client state
```

- [ ] **Step 2: Update stale references in other docs**

Update these files to remove bloom-channels and bloom-topics references:
- `README.md` — remove bloom-channels and bloom-topics rows from extension table
- `docs/service-architecture.md` — remove bloom-channels and bloom-topics from the architecture diagram and extension table
- `skills/recovery/SKILL.md` — update "Check Pi agent is running and bloom-channels extension loaded" to reference pi-daemon instead

- [ ] **Step 3: Update CLAUDE.md key paths**

Add to the Key Paths table:

```markdown
| `~/.pi/pi-daemon/rooms.json` | Room-to-session mapping for pi-daemon | No |
```

- [ ] **Step 4: Run lint**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md CLAUDE.md README.md docs/service-architecture.md skills/recovery/SKILL.md
git commit -m "docs: update docs for pi-daemon architecture, remove bloom-channels/topics refs"
```

---

### Task 13: Final verification

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: compiles cleanly.

- [ ] **Step 2: Full test suite**

Run: `npm run test`
Expected: all tests pass.

- [ ] **Step 3: Full lint**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 4: Coverage check**

Run: `npm run test:coverage`
Expected: daemon/ meets 55% line coverage target (lib/ baseline).

- [ ] **Step 5: Verify no stale references**

```bash
grep -r "bloom-pi-agent" --include="*.ts" --include="*.md" --include="*.service" --include="*.sh" .
grep -r "bloom-channels" --include="*.ts" --include="*.md" --include="*.yaml" --include="*.conf" .
grep -r "bloom-topics" --include="*.ts" --include="*.md" --include="*.yaml" --include="*.conf" .
```

Expected: results only in `docs/superpowers/specs/`, `docs/superpowers/plans/`, and `.claude/agent-memory/` (historical references). No results in source code, active docs, or config files.
