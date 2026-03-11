# Always-On Pi Daemon with Matrix-Native Room Architecture

**Status:** Approved design
**Date:** 2026-03-11

## Problem

Pi only runs during interactive terminal sessions. When the user logs out, Matrix messages go unanswered. The current workaround (`bloom-pi-agent.service` running `script -qfc "pi --continue"`) is fragile. Additionally, conversation organization is split across three overlapping concepts: bloom-topics (branchPoints within a session), Matrix rooms, and Pi sessions (JSONL files).

## Solution

A single headless Node.js daemon (`pi-daemon`) uses Pi's SDK to manage multiple `AgentSession` instances — one per Matrix room. Matrix rooms become the primary organizational unit, replacing bloom-topics. The interactive terminal remains independent.

## Architecture

### Tier Classification

The daemon is **OS-level infrastructure** — a native systemd user service baked into the image, alongside `bloom-matrix.service` and `netbird.service`. It is not an extension (no TUI), not a container service (needs direct SDK access), and not a skill (it's a long-running process). This extends the existing infrastructure tier to include user-scoped services.

### Core Components

```
daemon/ (new top-level directory, added to tsconfig.json include paths)
├── index.ts              — Entry point, wires components, starts service
├── matrix-listener.ts    — Matrix bot-sdk client, room event handler
├── session-pool.ts       — AgentSession lifecycle (create/resume/dispose)
└── room-registry.ts      — rooms.json read/write, room-to-session mapping
```

### How It Works

1. Daemon starts after first-boot setup (`ConditionPathExists=~/.bloom/.setup-complete`)
2. Connects to Continuwuity as `@pi:bloom` via matrix-bot-sdk
3. Auto-joins rooms via `AutojoinRoomsMixin`
4. On incoming message: looks up or creates an `AgentSession` for that room
5. Calls `session.prompt(text)` on the room's session
6. Subscribes to session events, sends assistant response back to the Matrix room
7. Idle sessions are disposed after 15 minutes (session file persists on disk)
8. On daemon restart: loads `rooms.json`, lazy-resumes sessions on first message

### Error Handling

- **Matrix unreachable at start**: Retry with exponential backoff (5s, 15s, 60s, 300s max). Log each retry.
- **`session.prompt()` failure**: Catch, send error summary to room (`"Sorry, I hit an error: ..."`), log full error. Do not dispose session.
- **API key expired/invalid**: Log error, send one-time notification to `#general:bloom` ("My API key needs attention"), stop prompting until key is refreshed.
- **Corrupted session file**: Log warning, archive the corrupted file, create a fresh session for that room. Notify the room.
- **Process crash**: `Restart=on-failure` with `RestartSec=15` handles systemd-level recovery.

### Graceful Shutdown

On SIGTERM: dispose all loaded sessions, disconnect Matrix client, flush `rooms.json` to disk, then exit.

### Interactive Terminal

The daemon is always running — it never stops for interactive sessions. The terminal is completely independent:

- Normal `pi` with Bloom extensions (persona, guardrails, audit, garden, os, services, dev, repo)
- Its own session (JSONL file), not tied to any Matrix room
- Shared filesystem: `~/Bloom/`, `~/.pi/` — both daemon and terminal see the same files
- No `bloom-channels` or `bloom-topics` extensions (retired)

The daemon and terminal run in parallel without coordination. They share the filesystem and persona but not sessions. Matrix rooms are the persistent organizational layer; the terminal session is ephemeral.

## Room-to-Session Mapping

### Registry

`~/.pi/pi-daemon/rooms.json`:

```json
{
  "!abc123:bloom": {
    "roomAlias": "#general:bloom",
    "sessionPath": "/home/pi/.pi/agent/sessions/bloom-rooms/2026-03-11_uuid.jsonl",
    "created": "2026-03-11T15:00:00Z",
    "lastActive": "2026-03-11T16:30:00Z",
    "archived": false
  }
}
```

### Session Creation

First message in a new room triggers:

```typescript
const sessionDir = join(os.homedir(), ".pi", "agent", "sessions", "bloom-rooms");
const { session } = await createAgentSession({
  cwd: os.homedir(),
  sessionManager: SessionManager.create(os.homedir(), sessionDir),
  resourceLoader, // Bloom extensions via extensionFactories
  // model, auth, settings inherited from daemon config
});
```

Each session gets:
- Persistent JSONL file in `~/.pi/agent/sessions/bloom-rooms/`
- Bloom extensions loaded via `extensionFactories` (see Extension Loading below)
- Room context in system prompt: `"You are Pi in Matrix room #general:bloom."`

### Session Lifecycle

- **Create**: Automatic on first message in a room
- **Resume**: `SessionManager.open(path)` on first message after daemon restart
- **Dispose**: After 15 minutes idle, `session.dispose()` frees memory. Session file persists.
- **Archive**: Pi marks room as `archived: true` in registry, stops listening. Room remains in Matrix.

### Memory Management

Keep at most `BLOOM_DAEMON_MAX_SESSIONS` sessions loaded (default: 3, configurable via environment variable). When the limit is exceeded, the least-recently-used session is disposed. Resumed transparently on next message.

## Extension Loading

Each room's session loads a curated subset of Bloom extensions via `extensionFactories`:

| Extension | Loaded | Reason |
|-----------|--------|--------|
| bloom-persona | Yes | Identity, guardrails, compaction context |
| bloom-audit | Yes | Tool call logging |
| bloom-garden | Yes | Bloom directory structure |
| bloom-os | Yes | OS update awareness |
| bloom-services | Yes | Service management tools |
| bloom-objects | Yes | Object tracking |
| bloom-dev | Yes | If dev mode enabled |
| bloom-repo | Yes | If dev mode enabled |
| bloom-rooms (new, inline) | Yes | Room management tools (see below) |
| bloom-channels | No | Retired, replaced by daemon |
| bloom-topics | No | Retired, replaced by rooms |
| bloom-setup | No | Daemon only runs after setup |

Extensions are passed via `DefaultResourceLoader({ extensionFactories })`, not discovered from disk.

### Room Tools (bloom-rooms inline extension)

Room management tools are registered via an inline extension factory passed to `extensionFactories`, following the SDK pattern from `examples/sdk/06-extensions.ts`:

```typescript
const bloomRoomsFactory = (pi: ExtensionAPI) => {
  pi.registerTool({
    name: "room_create",
    // ...creates Matrix room, adds to Bloom space, registers in rooms.json
  });
  pi.registerTool({
    name: "room_archive",
    // ...marks room as archived in registry
  });
};
```

This is consistent with the extension registration pattern — tools are registered via `pi.registerTool()`.

## Matrix Organization

### Bloom Space

A Matrix space named `Bloom` is created during first-boot setup. All Pi-managed rooms live inside it. This gives a clean hierarchical view in Cinny.

### Default Rooms

Created during first-boot:
- `#general:bloom` — default catch-all room, always exists

### Shared Brain

All sessions share one persona (`~/Bloom/Persona/`), one set of guardrails, and one filesystem. Pi in `#deploy` knows the same facts as Pi in `#general` at the persona level. Detailed conversation history is room-scoped (each session has its own JSONL tree).

If Pi in one room needs context from another, it can read that session's file or the user can reference it ("remember what we did in #deploy"). No automatic cross-room context sharing.

## Retired Components

### bloom-topics (full removal)

Rooms replace topics entirely. `/topic new`, `/topic switch`, `/topic close` commands removed. Sub-organization within a room is handled by Pi's native session tree branching (`/tree`).

**Files to delete:**
- `extensions/bloom-topics/index.ts`
- `extensions/bloom-topics/actions.ts`
- `extensions/bloom-topics/types.ts`

### bloom-channels (full removal)

Matrix message routing moves from an extension into the daemon process. The `registerMatrixAccount()` function is relocated to `lib/matrix.ts` (which already exports related utilities like `matrixCredentialsPath`, `generatePassword`, `MatrixCredentials`).

**Files to delete:**
- `extensions/bloom-channels/index.ts`
- `extensions/bloom-channels/actions.ts`
- `extensions/bloom-channels/matrix-client.ts`
- `extensions/bloom-channels/types.ts`

**Function to relocate:**
- `registerMatrixAccount()` (and helpers `registerStep2`, `parseRegistrationError`) → `lib/matrix.ts`

### bloom-pi-agent.service (replaced)

Replaced by `pi-daemon.service`. No more PTY hacks.

**Files to delete:**
- `os/sysconfig/bloom-pi-agent.service`

## Modified Components

### tsconfig.json

Add `daemon/**/*.ts` to the `include` array so the daemon compiles with the rest of the project.

### bloom-bash_profile

No longer stops/starts a daemon on login/logout. Interactive login just runs `pi`:

```bash
if [ -t 0 ] && [ -z "$PI_SESSION" ] && mkdir /tmp/.bloom-pi-session 2>/dev/null; then
  trap 'rmdir /tmp/.bloom-pi-session 2>/dev/null' EXIT
  export PI_SESSION=1
  /usr/local/bin/bloom-greeting.sh
  exec pi
fi
```

The daemon runs independently via systemd.

### bloom-setup/actions.ts

`touchSetupComplete()` enables AND starts `pi-daemon.service` (not just enable — the user shouldn't need to reboot after first-boot setup). Also creates the Bloom Matrix space and `#general:bloom` room.

```typescript
await run("systemctl", ["--user", "enable", "--now", "pi-daemon.service"]);
```

### bloom-persona

Remove both `pendingChannels` and `activeTopic` fields from `BloomContext`. Both are dead after bloom-topics and bloom-channels removal. The `loadContext()` function already uses loose JSON parsing, so existing `bloom-context.json` files with these fields are handled gracefully (extra keys ignored). Also update the `session_before_compact` hook handler to stop collecting these fields.

### Containerfile

Install `pi-daemon.service` instead of `bloom-pi-agent.service`.

### AGENTS.md

Update to reflect:
- Remove bloom-channels and bloom-topics from extension documentation
- Remove `/topic` commands from command reference
- Add pi-daemon to OS-level infrastructure table
- Update sequence diagrams to show daemon message flow
- Add `rooms.json` to key paths

### CLAUDE.md

Add `~/.pi/pi-daemon/rooms.json` to the Key Paths table.

## New Files

```
daemon/
├── index.ts              — Entry point, wires components, starts service
├── matrix-listener.ts    — Matrix bot-sdk client, room event handler
├── session-pool.ts       — AgentSession lifecycle (create/resume/dispose)
└── room-registry.ts      — rooms.json read/write, room-to-session mapping
os/sysconfig/
└── pi-daemon.service  — Systemd user service unit
```

### pi-daemon.service

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

## Testing Strategy

- **Unit tests** (`tests/daemon/`): `room-registry.ts` (JSON read/write, LRU logic), `session-pool.ts` (mock `createAgentSession`)
- **Integration tests**: Daemon with mock Matrix client, verify message routing and session creation
- **Extension loading test**: Verify correct extensions loaded per session (no bloom-channels, no bloom-topics)
- **Memory management test**: Verify LRU eviction, transparent resume after dispose
- **Error handling tests**: Corrupted session recovery, Matrix disconnect/reconnect, prompt failure handling
- **Coverage**: daemon/ should target 55% line coverage (same as lib/)

## Migration

For existing Bloom installations:
1. `bloom-topics` custom entries in existing sessions become inert (harmless, just ignored)
2. `bloom-channels` extension simply stops loading (no data migration needed)
3. `registerMatrixAccount` moved to `lib/matrix.ts` — callers updated
4. `bloom-pi-agent.service` disabled and replaced by `pi-daemon.service`
5. Existing `~/.pi/matrix-credentials.json` used by daemon (same schema)
6. First daemon start creates `rooms.json` and Bloom space
7. `matrix-bot-sdk` remains as existing project dependency (no new deps needed)
