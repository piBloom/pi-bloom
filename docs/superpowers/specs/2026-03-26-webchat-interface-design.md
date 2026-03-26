# Web Chat Interface Implementation Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the Matrix-based daemon and Element Web with a minimal Node.js chat server that serves a `@mariozechner/pi-web-ui` ChatPanel, connecting users to the Pi agent (with all its extensions) through a browser.

**Architecture:** A single small Node.js process (`nixpi-chat`) runs on `127.0.0.1:8080`, serves a static HTML page embedding the pi-web-ui ChatPanel, and exposes a streaming HTTP endpoint that spawns and manages Pi agent subprocesses per session. nginx continues to handle TLS and proxies `https://<host>/` to port 8080.

**Tech Stack:** Node.js + TypeScript, `@mariozechner/pi-web-ui` (ChatPanel web component), `pi-coding-agent` CLI (spawned as subprocess per session), esbuild (frontend bundling), NixOS systemd service.

---

## Context

This spec is Phase 1 of a two-phase simplification:
- **Phase 1 (this spec):** Replace the Matrix daemon + Element Web with a pi-web-ui chat page.
- **Phase 2 (future):** Refactor agent model (single-chat, subagent spawning).

### Prerequisite: Continuwuity cleanup

Before building the new chat server, all remaining `continuwuity` references must be removed from test files and wizard scripts. These are stale references from the Matrix homeserver removal (tracked separately). This cleanup is Task 1 of the implementation plan.

---

## What gets removed

| Removed | Replaced by |
|---|---|
| `core/daemon/` (entire Matrix daemon) | `core/chat-server/` |
| `core/os/services/nixpi-element-web.nix` | Chat server serves WebChat |
| `core/os/services/nixpi-home.nix` | Chat server serves home at `/` |
| `core/os/services/home-template.html` | pi-web-ui ChatPanel |
| `core/lib/matrix.ts` | Gone |
| `core/lib/matrix-format.ts` | Gone |
| `core/pi/extensions/matrix-admin/` | Gone |
| `nixpi-element-web` NixOS options | Gone |
| Matrix credential wizard step | Simplified (no credentials needed) |

## What stays

- All Pi extensions: persona, OS, episodes, objects, nixpi
- nginx — still handles TLS, proxies `/` to port 8080
- NixOS module structure — new `nixpi-chat.nix` replaces home + element-web services
- First-boot wizard — Matrix credential step removed entirely (no external account needed)
- Scheduler — removed for now (its outputs were Matrix messages; Phase 2 will reintroduce it with the new transport)

---

## Components

### 1. Chat server (`core/chat-server/`)

**`core/chat-server/index.ts`** — Entry point. HTTP server on `127.0.0.1:8080`:
- `GET /` — serves `dist/index.html`
- `GET /assets/*` — serves bundled frontend assets
- `POST /chat` — streaming endpoint (newline-delimited JSON events)
- `DELETE /chat/:sessionId` — reset a session

**`core/chat-server/session.ts`** — Session manager. Keyed by session ID (UUID, stored in browser localStorage). Each session is a pi-coding-agent subprocess:
- Spawns `pi-coding-agent` CLI with `PI_DIR=~/.pi` and `NIXPI_DIR=~/nixpi`
- Pipes stdin/stdout for streaming turn-by-turn interaction
- Idle timeout: 30 minutes (configurable via `nixpi.chat.sessionIdleTimeout`)
- Max concurrent sessions: 4

**`core/chat-server/frontend/index.html`** — Minimal HTML shell that loads the bundled ChatPanel and wires it to the `/chat` endpoint via a custom provider.

### 2. Frontend bundle (`core/chat-server/frontend/`)

Built with esbuild. Imports:
- `@mariozechner/pi-web-ui` — `ChatPanel` web component
- Custom provider class that calls `POST /chat` and streams responses

Output: `dist/index.html` + `dist/assets/app.js` + `dist/assets/app.css`

### 3. NixOS service (`core/os/services/nixpi-chat.nix`)

Replaces `nixpi-home.nix` and `nixpi-element-web.nix`. Systemd service running the chat server:
- `ExecStart`: `nixpi-chat-server`
- User: `${primaryUser}`
- Environment: `PI_WORKSPACE`, `PI_STATE_DIR`, `NIXPI_CHAT_PORT`
- `After`: `network.target`

### 4. NixOS options (`core/os/modules/options.nix`)

Remove:
- `nixpi.elementWeb.*` (all options)

Add:
- `nixpi.chat.port` (default: `8080`)
- `nixpi.chat.sessionIdleTimeout` (default: `1800` seconds)
- `nixpi.chat.maxSessions` (default: `4`)

### 5. Service surface updates (`core/os/modules/service-surface.nix`)

Remove:
- `nixpi-element-web` proxy block (`/element/` location)
- Matrix proxy block (`/_matrix/` location)
- Well-known matrix locations

Update:
- Port 8080 proxy: points to `nixpi-chat` instead of `nixpi-home`

### 6. Wizard update (`core/scripts/wizard-matrix.sh` + `setup-wizard.sh`)

Remove the `step_matrix` function and its call from `setup-wizard.sh`. No credentials are collected — the chat server uses the Pi agent's existing Anthropic API key (already configured in the workspace).

---

## Streaming protocol (`POST /chat`)

Request body (JSON):
```json
{
  "sessionId": "uuid",
  "message": "user message text"
}
```

Response: `Content-Type: application/x-ndjson`, newline-delimited JSON events:
```json
{"type": "text", "content": "Hello, I'm Pi..."}
{"type": "tool_call", "name": "bash", "input": "ls -la"}
{"type": "tool_result", "name": "bash", "output": "..."}
{"type": "done"}
{"type": "error", "message": "..."}
```

The custom pi-web-ui provider maps these to the ChatPanel's streaming format.

---

## File map

```
core/
  chat-server/
    index.ts          HTTP server + route handlers
    session.ts        Pi agent session lifecycle
    frontend/
      index.html      HTML shell
      app.ts          pi-web-ui ChatPanel + custom provider
  os/
    services/
      nixpi-chat.nix  NixOS systemd service (replaces nixpi-home + nixpi-element-web)
      [DELETE] nixpi-home.nix
      [DELETE] nixpi-element-web.nix
      [DELETE] home-template.html
    modules/
      options.nix     Remove elementWeb options, add chat options
      service-surface.nix  Remove element-web + matrix proxy, update home proxy
  pi/
    extensions/
      [DELETE] matrix-admin/
  scripts/
    wizard-matrix.sh  Remove step_matrix
    setup-wizard.sh   Remove step_matrix call
[DELETE] core/daemon/
[DELETE] core/lib/matrix.ts
[DELETE] core/lib/matrix-format.ts
```

---

## Tests

- Unit tests for session manager (spawn, idle timeout, cleanup)
- Unit test for streaming protocol handler
- NixOS integration test (`nixpi-home.nix` → replaced by chat server smoke test):
  - Chat server starts and serves HTML at `/`
  - `POST /chat` returns streaming response
  - Session is created and reused on second request
  - Session is cleaned up after idle timeout

---

## What this does NOT include

- WhatsApp adapter (future)
- Agent model refactor / subagent spawning (Phase 2)
- Voice input/output
- Multi-user support (single user, personal device)
