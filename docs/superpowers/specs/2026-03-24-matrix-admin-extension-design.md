# Matrix Admin Extension Design

**Date:** 2026-03-24
**Status:** Approved
**Topic:** Give the pi agent the ability to issue Continuwuity admin commands from within Matrix

---

## Overview

The pi agent (nixpi-daemon) runs as a Matrix room supervisor on a local Continuwuity homeserver. Currently it can only send and receive messages. This extension gives it a new Pi tool — `matrix_admin` — that sends `!admin` commands to the Continuwuity admin room, captures the server bot's response, and returns it to the agent.

Continuwuity has no REST admin API yet. All admin operations are performed by sending `!admin <subcommand>` messages to the server's `#admins:nixpi` room, where the built-in server bot (`@conduit:nixpi`) replies with results.

---

## Architecture

### Approach

A self-contained Pi extension (`matrix-admin`) that calls the Continuwuity Matrix Client-Server API directly via `fetch`. No daemon changes required.

### Data Flow

```
Pi agent calls matrix_admin tool
  → extension captures sync `since` token (current timeline position)
  → POST !admin <command> to admin room via CS API
  → long-poll /sync with `since` token, filtering to admin room (timeout: 15s)
  → find first m.room.message from @conduit:nixpi
  → return { ok: true, response: "<server reply>" }
```

### Credentials

Uses `@pi:nixpi`'s existing access token from `~/.pi/matrix-credentials.json`. No new credentials needed.

### Admin Room Discovery

On first use, the extension scans joined rooms for `#admins:nixpi`, caches the result in `~/.pi/matrix-admin.json`. Subsequent calls use the cached room ID directly.

---

## Tool Interface

```typescript
tool: "matrix_admin"

input: {
  command: string          // e.g. "users create-user --username alex --password s3cr3t"
  body?: string            // optional newline-delimited list for bulk codeblock commands
  await_response?: boolean // default true; false for fire-and-forget
  timeout_ms?: number      // default 15000
}

output: {
  ok: boolean
  response?: string        // server bot reply text
  error?: string           // "timeout" | "send failed: <status>" | "admin room not found"
}
```

The `command` value is everything after `!admin `. The extension prepends the prefix automatically.

### Codeblock Commands

Some commands require a newline-delimited list in a Markdown codeblock (e.g. `deactivate-all`, `ban-list-of-rooms`). Pass the list via the `body` field:

```typescript
{
  command: "rooms moderation ban-list-of-rooms",
  body: "!badroom1:nixpi\n!badroom2:nixpi"
}
```

The extension formats the full message as:

```
!admin rooms moderation ban-list-of-rooms
```
!badroom1:nixpi
!badroom2:nixpi
```
```

---

## File Structure

### New files

```
core/pi/extensions/matrix-admin/
  index.ts      — tool definition and registration
  client.ts     — Matrix CS API: send message, incremental sync, room discovery
  commands.ts   — typed command catalogue and dangerous command list
```

### Modified files

```
core/pi/extensions/index.ts   — register the matrix-admin extension
```

### Config sidecar (auto-created on first run)

```
~/.pi/matrix-admin.json
{
  "adminRoomId": "!abc123:nixpi"
}
```

---

## Full Command Surface

### `!admin users`

| Command | Description | Dangerous |
|---|---|---|
| `users list-users` | List all local users | |
| `users create-user --username <u> --password <p>` | Create a user | |
| `users reset-password <@u:nixpi> --password <p>` | Reset password | |
| `users deactivate <@u:nixpi>` | Deactivate user, removes from rooms | ⚠️ |
| `users deactivate-all` | Deactivate list of users (codeblock) | ⚠️ |
| `users logout <@u:nixpi>` | Invalidate all access tokens | ⚠️ |
| `users suspend <@u:nixpi>` | Can read but not send | |
| `users unsuspend <@u:nixpi>` | Reverse suspend | |
| `users lock <@u:nixpi>` | Temporary deactivation | |
| `users unlock <@u:nixpi>` | Reverse lock | |
| `users enable-login <@u:nixpi>` | Allow new sessions | |
| `users disable-login <@u:nixpi>` | Block new sessions | |
| `users list-joined-rooms <@u:nixpi>` | List rooms a user is in | |
| `users force-join-room <@u:nixpi> <roomId>` | Force join user to room | |
| `users force-leave-room <@u:nixpi> <roomId>` | Force leave | |
| `users force-demote <@u:nixpi> <roomId>` | Drop power level to default | |
| `users make-user-admin <@u:nixpi>` | Grant server-admin privileges | ⚠️ |
| `users redact-event <@u:nixpi> <eventId>` | Force-redact an event | |
| `users force-join-list-of-local-users <roomId>` | Bulk force-join (codeblock, requires `--yes-i-want-to-do-this`) | ⚠️ |
| `users force-join-all-local-users <roomId>` | Join all local users to room | ⚠️ |

### `!admin rooms`

| Command | Description | Dangerous |
|---|---|---|
| `rooms list-rooms` | List all rooms the server knows about | |
| `rooms info <roomId>` | View room details | |
| `rooms info list-joined-members <roomId>` | List joined members | |
| `rooms info view-room-topic <roomId>` | View room topic | |
| `rooms moderation ban-room <room>` | Ban room, evict all local users | ⚠️ |
| `rooms moderation ban-list-of-rooms` | Bulk ban (codeblock) | ⚠️ |
| `rooms moderation unban-room <room>` | Unban room | |
| `rooms moderation list-banned-rooms` | List banned rooms | |
| `rooms alias set <#alias:nixpi> <roomId>` | Set a room alias | |
| `rooms alias remove <alias>` | Remove a local alias | |
| `rooms alias which <alias>` | Which room uses an alias | |
| `rooms alias list` | List all aliases | |
| `rooms directory publish <roomId>` | Publish to room directory | |
| `rooms directory unpublish <roomId>` | Unpublish from directory | |
| `rooms directory list` | List published rooms | |
| `rooms exists <roomId>` | Check if room is known | |

### `!admin server`

| Command | Description | Dangerous |
|---|---|---|
| `server uptime` | Time since startup | |
| `server show-config` | Show all config values (contains secrets) | |
| `server reload-config` | Reload config from disk | |
| `server memory-usage` | DB memory stats | |
| `server clear-caches` | Clear all caches | |
| `server backup-database` | Online RocksDB backup | |
| `server list-backups` | List DB backups | |
| `server admin-notice <message>` | Send message to admin room | |
| `server reload-mods` | Hot-reload server | |
| `server restart` | Restart server | ⚠️ |
| `server shutdown` | Shutdown server | ⚠️ |

### `!admin federation`

| Command | Description |
|---|---|
| `federation incoming-federation` | List rooms handling incoming PDU |
| `federation disable-room <roomId>` | Disable incoming federation for room |
| `federation enable-room <roomId>` | Re-enable federation for room |
| `federation fetch-support-well-known <server>` | Fetch `/.well-known/matrix/support` |
| `federation remote-user-in-rooms <@u:server>` | List shared rooms with remote user |

### `!admin media`

| Command | Description | Dangerous |
|---|---|---|
| `media delete <mxc or eventId>` | Delete single media file | |
| `media delete-list` | Delete codeblock list of MXC URLs | ⚠️ |
| `media delete-past-remote-media -b <duration>` | Delete remote media older than duration | ⚠️ |
| `media delete-all-from-user <@u:nixpi>` | Delete all local media from user | ⚠️ |
| `media delete-all-from-server <server>` | Delete all remote media from server | ⚠️ |
| `media delete-url-preview [--all]` | Delete cached URL previews | |

### `!admin appservices`

| Command | Description | Dangerous |
|---|---|---|
| `appservices list-registered` | List all registered appservices | |
| `appservices register` | Register appservice (YAML codeblock) | |
| `appservices unregister <id>` | Unregister appservice | ⚠️ |
| `appservices show-appservice-config <id>` | Show appservice config | |

### `!admin token`

Registration token management (create, list, revoke) — used to control who can self-register.

### `!admin check` / `!admin debug` / `!admin query`

Low-level integrity checks, PDU debugging, and raw DB queries. Available to the agent but not documented in agent instructions — use only when explicitly requested by the user.

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Timeout (no reply within 15s) | `{ ok: false, error: "timeout" }` |
| HTTP error sending message | `{ ok: false, error: "send failed: <status>" }` |
| Server bot replies with error text | `{ ok: true, response: "<error text>" }` — agent reads and reports |
| Admin room ID not found | `{ ok: false, error: "admin room not found" }` |
| `await_response: false` | Send and return `{ ok: true }` immediately |

---

## Agent Instructions (to add to AGENTS.md)

```markdown
## Matrix Admin Commands

Use the `matrix_admin` tool to manage the Continuwuity homeserver.
Pass the command string exactly as shown below (without the `!admin` prefix).

### Rules
- Commands marked ⚠️ are destructive or irreversible. Always confirm with the user before running them.
- For bulk operations requiring a codeblock, pass the newline-delimited list in the `body` field.
- If a command returns an error, report it verbatim and ask the user how to proceed.
- `server show-config` contains secrets — do not display the full output unless the user asks.

### Common commands
- `users list-users` — list all local users
- `users create-user --username <u> --password <p>` — create a user
- `users reset-password <@u:nixpi> --password <p>` — reset password
- `users deactivate <@u:nixpi>` — deactivate user ⚠️
- `users make-user-admin <@u:nixpi>` — grant admin ⚠️
- `users force-join-room <@u:nixpi> <roomId>` — force join
- `users list-joined-rooms <@u:nixpi>` — list user's rooms
- `rooms list-rooms` — list all rooms
- `rooms info <roomId>` — room details
- `rooms alias set <#alias:nixpi> <roomId>` — set alias
- `rooms directory publish <roomId>` — publish to directory
- `rooms moderation ban-room <roomId>` — ban room ⚠️
- `server uptime` — server uptime
- `server memory-usage` — memory stats
- `server clear-caches` — clear caches
- `server restart` — restart server ⚠️
- `server shutdown` — shutdown server ⚠️
- `appservices list-registered` — list bridges
- `appservices unregister <id>` — remove bridge ⚠️
```

---

## Testing Plan

1. **Unit tests** — mock CS API responses; verify sync polling logic, codeblock formatting, timeout handling
2. **Integration test** — register a test user via `users create-user`, verify it appears in `users list-users`, deactivate it
3. **Timeout test** — simulate no server reply; verify graceful `{ ok: false, error: "timeout" }` return
4. **Admin room discovery** — clear cache, verify room is found and cached on first call
5. **Dangerous command guard** — verify agent instructions are correct in loaded AGENTS.md
