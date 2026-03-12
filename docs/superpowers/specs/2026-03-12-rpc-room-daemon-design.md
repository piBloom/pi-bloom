# RPC Room Daemon Design

Date: 2026-03-12

## Goal

Replace the programmatic `AgentSession` daemon with a simpler architecture: one `pi --mode rpc` subprocess per Matrix room, multiplexed over Unix sockets so both Matrix and a terminal can interact with the same Pi session bidirectionally.

## Motivation

The current daemon (`session-pool.ts`, `room-registry.ts`, `index.ts`) manages `AgentSession` instances programmatically — loading extensions, wiring events, handling LRU eviction, persisting session files. This works but:

1. **Invisible**: No way to see what Pi is doing in a room from a terminal
2. **Duplicated work**: The daemon reimplements session lifecycle that `pi` already handles
3. **No shared context**: Terminal `pi` and Matrix Pi are completely separate conversations

Pi SDK's RPC mode (`pi --mode rpc`) communicates via structured JSON over stdin/stdout. This lets us treat `pi` as a black box: spawn it, pipe messages in, read events out. The daemon becomes a thin process manager + socket multiplexer.

## Architecture

Two components. That's it.

### 1. Room Daemon

Replaces the current daemon entirely. Single Node.js process that:

- Listens for Matrix messages (reuses `MatrixListener` mostly unchanged)
- Spawns `pi --mode rpc` subprocesses on demand (one per room)
- Opens a Unix socket per room for terminal clients
- Fans out pi's stdout events to all connected socket clients AND to Matrix
- Fans in commands from Matrix and socket clients to pi's stdin
- Kills idle processes after timeout

### 2. Terminal Client (`bloom attach`)

Connects to a room's Unix socket. Renders events. Accepts input. ~80 lines.

```
bloom attach general        # prefix-matches room-general_bloom.sock
bloom attach                # list available rooms
```

Room name argument does prefix matching against socket filenames (after stripping the `room-` prefix). So `bloom attach general` matches `room-general_bloom.sock`. If multiple matches, list them and ask the user to be more specific.

### Data Flow

```
┌──────────────────────────────────────────────────────┐
│  per room                                            │
│                                                      │
│  pi --mode rpc              (subprocess)             │
│      ↕ stdin/stdout (JSON lines)                     │
│  Room Daemon                (manages process+socket) │
│      ↕ Unix socket                                   │
│      ├── Matrix relay       (room daemon itself)     │
│      └── Terminal client    (bloom attach)           │
│                                                      │
└──────────────────────────────────────────────────────┘
```

**Matrix → Pi:**
```
Matrix message → MatrixListener → daemon.handleMessage(roomId, sender, body)
  → get or spawn pi process for room
  → write to stdin: {"type":"prompt","message":"[matrix: @user] hello"}
```

**Pi → Matrix:**
```
pi stdout emits JSON lines → daemon reads each line
  → forward to all socket clients (fan-out)
  → on agent_end: extract response text → listener.sendText(roomId, text)
```

**Terminal → Pi:**
```
user types in bloom attach → terminal client sends over socket
  → {"type":"prompt","message":"what's up"}
  → daemon reads from socket → writes to pi's stdin
```

**Pi → Terminal:**
```
pi emits text_delta events → daemon forwards to socket clients
  → terminal client renders deltas to stdout
```

### Concurrent Input

The daemon tracks a `streaming: boolean` flag per room (set on `agent_start`, cleared on `agent_end`).

- Matrix messages: send `{"type":"prompt"}` when idle, `{"type":"follow_up"}` when streaming
- Terminal input: same logic — `prompt` when idle, `follow_up` when streaming
- Terminal Ctrl+C → `{"type":"steer","message":"stop"}` (interrupt after current tool)
- Terminal Ctrl+C twice rapidly → `{"type":"abort"}` (hard stop)

## Room Lifecycle

### Spawn on demand

Matrix message arrives for a room → daemon checks if a `pi` process exists for that room. If not → spawn `pi --mode rpc` with the room's session dir. Store in a `Map<roomId, RoomProcess>` where `RoomProcess` holds the child process, socket server, and connected clients list.

### Idle cleanup

No message for 15 minutes → kill the `pi` process, close the socket, remove from map. Socket file deleted on cleanup. Next message spawns a fresh process — pi resumes from its own session file.

No max-process cap. The old `BLOOM_DAEMON_MAX_SESSIONS` LRU eviction is intentionally dropped — each room is now an independent OS process, and the idle timeout is sufficient to bound memory. If 10 rooms are active simultaneously, that's fine — the user chose to use 10 rooms. Hardware is the only limit.

### Crash recovery

If `pi` process exits unexpectedly → log it, clean up the map entry. Next message triggers a fresh spawn. No automatic respawn of idle rooms — only on demand.

### Session persistence

Each room gets a session dir: `~/.pi/agent/sessions/bloom-rooms/{roomAlias}/`. Pi's RPC mode handles session files internally — the daemon does not manage `.jsonl` files. Room-to-session mapping is implicit from the directory name. No `rooms.json` registry file.

### Socket location

`$XDG_RUNTIME_DIR/bloom/room-{alias}.sock` (e.g., `/run/user/1000/bloom/room-general_bloom.sock`). The daemon creates the `bloom/` subdirectory on startup (`mkdirSync` with `recursive: true`). Terminal client discovers available rooms by listing socket files in that directory.

## Terminal Client UX

### What you see

- Pi's text responses streamed in real-time (`text_delta` → stdout)
- Tool calls shown as one-liners: `[tool: read_file README.md]`
- Tool results not shown (too noisy)
- Thinking blocks hidden

### What you type

- Plain text → sent as `{"type":"prompt","message":"..."}`
- Ctrl+C → sends `{"type":"abort"}` to interrupt Pi
- Ctrl+D → disconnect (Pi process stays alive)

### No TUI framework

Just readline for input and stdout for output. Works over SSH, works in a Zellij pane, works piped to a file.

## File Changes

### Deleted

| File | Reason |
|------|--------|
| `daemon/session-pool.ts` | Replaced by subprocess management in room daemon |
| `daemon/room-registry.ts` | Replaced by socket files + directory naming |
| `tests/daemon/session-pool.test.ts` | Tests for deleted code |
| `tests/daemon/room-registry.test.ts` | Tests for deleted code |
| `extractResponseText()` in `lib/matrix.ts` | Function removed (file kept). Replaced by reading `agent_end` JSON directly |

### Kept (mostly unchanged)

| File | Notes |
|------|-------|
| `daemon/matrix-listener.ts` | Same Matrix bot-sdk connection, message events, sending |
| `lib/matrix.ts` | Credential helpers still needed |
| `os/system_files/usr/lib/systemd/user/pi-daemon.service` | Same service, same lifecycle |
| `tests/daemon/matrix-listener.test.ts` | Still valid |
| Matrix listener retry loop in `daemon/index.ts` | Carried forward to rewritten index.ts |

### New

| File | Purpose | ~Lines |
|------|---------|--------|
| `daemon/room-process.ts` | Spawn pi subprocess, manage Unix socket, fan-out/fan-in | ~150 |
| `daemon/index.ts` | Rewritten: wiring MatrixListener + room process management | ~100 |
| `cli/bloom-attach.ts` | Terminal client: connect, render, input | ~80 |
| `tests/daemon/room-process.test.ts` | Spawn/kill lifecycle, socket fan-out, idle timeout | ~120 |
| `ARCHITECTURE.md` (Daemon section) | Rewrite to describe new subprocess + socket architecture | — |

### Net diff

Remove ~350 lines (session-pool + room-registry + their tests). Add ~450 lines (room-process + bloom-attach + tests). Net: +100 lines, but gains terminal access and crash isolation per room.

## Trade-offs

### Memory

Each room is a separate Node.js process (~100-200MB). At 10 rooms that's 1-2GB. Acceptable — bounded by user's hardware, and idle rooms are killed after 15min.

### Latency

First message to a new/idle room has cold-start latency (spawning `pi --mode rpc`). Subsequent messages are instant. Same as current architecture where session creation has latency.

### Dependency on Pi SDK RPC mode

The architecture assumes `pi --mode rpc` is stable. If the RPC protocol changes, only `room-process.ts` needs updating (it's the only file that speaks the protocol).

## RPC Protocol Reference

Based on Pi SDK documentation. The subprocess is spawned as `pi --mode rpc`.

### Commands (daemon writes to pi's stdin, one JSON object per line)

The SDK offers two equivalent ways to queue messages during streaming: `{"type":"follow_up","message":"text"}` and `{"type":"prompt","message":"text","streamingBehavior":"followUp"}`. Same for `steer`. **Canonical form for this implementation: use the dedicated `follow_up` and `steer` commands** (not the `streamingBehavior` flag on `prompt`). This is simpler — the daemon always sends the right command type based on Pi's state.

```json
{"type":"prompt","message":"text"}
{"type":"follow_up","message":"text"}
{"type":"steer","message":"text"}
{"type":"abort"}
```

### Events (daemon reads from pi's stdout, one JSON object per line)

| Event | When | Key fields |
|-------|------|------------|
| `agent_start` | Pi begins processing | — |
| `agent_end` | Pi finishes | `messages` array (walk for last assistant text) |
| `message_update` | Streaming delta | `assistantMessageEvent.type` (`text_delta`, `text_start`, `text_end`, `toolcall_start`, `toolcall_end`, etc.) |
| `turn_start` / `turn_end` | Turn boundaries | `turn_end` has `message` + `toolResults` |
| `tool_execution_start` / `tool_execution_end` | Tool lifecycle | `toolName`, `toolCallId` |

### Response extraction

On `agent_end`, the `messages` array contains the full conversation. Walk backward to find the last assistant message with text content — same logic as current `extractResponseText()` but on JSON, not SDK objects.

## Implementation Details

### Room alias sanitization

Matrix aliases like `#general:localhost` and room IDs like `!abc123:localhost` contain characters unsafe for filenames and socket paths. Sanitize by stripping `#` and `!` prefixes and replacing `:` with `_`. Examples:

- `#general:localhost` → `general_localhost`
- `#dev:bloom` → `dev_bloom`
- `!abc123:localhost` → `abc123_localhost` (fallback when no alias)

Applied to both session directory names and socket file names.

### Stdin write serialization

Multiple sources (Matrix relay + terminal clients) write to pi's stdin concurrently. The daemon serializes all writes through a single write queue per room to prevent interleaved bytes. Simple approach: a `writeToStdin(json)` method that uses a mutex or sequential promise chain.

### Per-room system prompt

Pass the room context via the prompt itself rather than SDK configuration. The first message to a freshly spawned `pi --mode rpc` includes a system-level preamble:

```json
{"type":"prompt","message":"[system] You are Pi in Matrix room #general:bloom. Respond to messages from this room.\n\n[matrix: @user] hello"}
```

Subsequent messages omit the preamble. Bloom extensions are loaded by `pi` from its standard config — no per-room extension customization needed.

### API key / auth error handling

When a `pi` subprocess exits with a non-zero code or emits an error event containing `401`, `invalid_api_key`, or `authentication`:

1. Send an error message to the Matrix room
2. Clean up the room process entry
3. If multiple rooms fail with auth errors within 60 seconds → the daemon exits for systemd restart (same as current behavior)

### `bloom attach` to idle room

If the socket file doesn't exist (room is idle/never started), `bloom attach` prints "No active session for this room" and exits. Connecting via terminal does NOT auto-spawn a pi process — only Matrix messages trigger spawns. This keeps the lifecycle simple and predictable.

### Graceful shutdown (SIGTERM)

1. Stop the Matrix listener (no new messages)
2. Send SIGTERM to all child `pi` processes
3. Wait up to 5 seconds for children to exit
4. Close all Unix sockets
5. Exit

### Idle timeout configurability

Default: 15 minutes. Override via `BLOOM_DAEMON_IDLE_TIMEOUT_MS` environment variable, matching the existing pattern of `BLOOM_DAEMON_MAX_SESSIONS`.

## Out of Scope

- Zellij layout integration (auto-tabs per room) — future enhancement
- Web-based session viewer — use terminal client instead
- Multi-user terminal access controls — single-user system
- Custom per-room model/extension configuration — pi's own config handles this
