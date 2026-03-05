# Bloom UI Protocol (v0.1)

## Status
- **Owner:** Bloom core
- **Date:** 2026-03-05
- **Applies to:** `bloom-ui` service + `bloom-ui-bridge` extension
- **Scope:** Headless-first local web UI

---

## 1) Purpose

Define how the Bloom web UI communicates with Pi for:
- reading system state
- receiving live updates
- handling confirmation-gated operations
- executing safe control actions through existing Bloom tools

This protocol is local-first and optimized for reliability, auditability, and simple client implementation.

---

## 2) Design Goals

1. **Headless-first:** usable from phone/laptop browser without HDMI.
2. **API-driven ops:** no GUI click automation; real operations go through system APIs/tools.
3. **Observable:** user sees Pi activity in real time.
4. **Safe by default:** sensitive actions require confirmation.
5. **Simple v0.1:** minimal moving parts, clear message shapes.

---

## 3) Protocol Surfaces

## 3.1 HTTP JSON API

Used for:
- initial state bootstrap
- listing resources
- creating requests (operations)
- confirmation responses

Base path:
- `/api/v1`

Content type:
- `application/json`

## 3.2 WebSocket Event Stream

Used for:
- live action updates
- confirmation requests
- state changes

Endpoint:
- `/api/v1/stream`

Direction:
- server -> client events (primary)
- client -> server control frames (`ack`, `pong`)

---

## 4) Authentication & Session (v0.1)

1. User pairs once (pairing code / local setup flow).
2. UI receives short-lived session token (cookie or bearer).
3. WebSocket upgrade requires active session.
4. Unauthorized requests return `401`.

> Implementation detail (cookie vs bearer) is flexible in v0.1; behavior is normative.

---

## 5) Resource Model

## 5.1 Envelope

All HTTP responses use:

```json
{
  "data": {},
  "meta": {
    "request_id": "req_123",
    "timestamp": "2026-03-05T14:00:00Z",
    "protocol_version": "1.0"
  },
  "links": {}
}
```

## 5.2 Core Resources

- `system` — health + host status summary
- `services` — Bloom-managed services
- `actions` — operation lifecycle records
- `confirmations` — pending user decisions
- `network` — Wi-Fi and connectivity state (minimal in v0.1)

---

## 6) HTTP Endpoints (v0.1)

## 6.1 API Root (discovery)

`GET /api/v1`

```json
{
  "data": {
    "name": "bloom-ui-api",
    "version": "1.0"
  },
  "links": {
    "self": "/api/v1",
    "system": "/api/v1/system",
    "services": "/api/v1/services",
    "actions": "/api/v1/actions",
    "confirmations": "/api/v1/confirmations",
    "network": "/api/v1/network",
    "stream": "/api/v1/stream"
  }
}
```

## 6.2 System Overview

`GET /api/v1/system`

Returns summary state (health, load, memory, update status, etc.).

## 6.3 Services

`GET /api/v1/services`

Returns Bloom services and statuses.

## 6.4 Actions

`GET /api/v1/actions?status=pending|running|succeeded|failed&limit=50`

`POST /api/v1/actions`

Creates a requested action.

Request example:

```json
{
  "type": "os.update.check",
  "params": {}
}
```

Response:
- `202 Accepted` with created action record.

## 6.5 Confirmations

`GET /api/v1/confirmations`

`POST /api/v1/confirmations/{id}`

Request:

```json
{
  "decision": "approve",
  "comment": "Proceed"
}
```

`decision` values:
- `approve`
- `reject`

## 6.6 Network (minimal)

`GET /api/v1/network`

Optional v0.1 write operation (if backend support is ready):

`POST /api/v1/network/connect`

```json
{
  "ssid": "HomeWiFi",
  "passphrase": "..."
}
```

---

## 7) Action Lifecycle

Action object:

```json
{
  "id": "act_01HR...",
  "type": "os.update.check",
  "status": "running",
  "requires_confirmation": false,
  "requested_by": "user:web",
  "created_at": "2026-03-05T14:10:00Z",
  "updated_at": "2026-03-05T14:10:02Z",
  "result": null,
  "error": null,
  "links": {
    "self": "/api/v1/actions/act_01HR..."
  }
}
```

Statuses:
- `pending`
- `waiting_confirmation`
- `running`
- `succeeded`
- `failed`
- `cancelled`

Sensitive actions MUST enter `waiting_confirmation` before execution.

---

## 8) WebSocket Frames

## 8.1 Server -> Client

### hello

```json
{
  "type": "hello",
  "protocol_version": "1.0",
  "server_time": "2026-03-05T14:12:00Z"
}
```

### snapshot

Initial compact state after connect.

```json
{
  "type": "snapshot",
  "system": {"status": "ok"},
  "pending_confirmations": 1,
  "running_actions": 2
}
```

### event

```json
{
  "type": "event",
  "event_id": "evt_01HR...",
  "event_type": "action.updated",
  "timestamp": "2026-03-05T14:12:05Z",
  "payload": {
    "id": "act_01HR...",
    "status": "succeeded"
  }
}
```

Supported `event_type` values (v0.1):
- `system.updated`
- `service.updated`
- `action.created`
- `action.updated`
- `confirmation.requested`
- `confirmation.resolved`
- `notification`

### ping

```json
{"type":"ping","ts":"2026-03-05T14:12:10Z"}
```

## 8.2 Client -> Server

### ack

```json
{
  "type": "ack",
  "event_id": "evt_01HR..."
}
```

### pong

```json
{"type":"pong","ts":"2026-03-05T14:12:10Z"}
```

### subscribe (optional)

```json
{
  "type": "subscribe",
  "topics": ["actions", "confirmations", "system"]
}
```

---

## 9) Error Model

HTTP errors:

```json
{
  "error": {
    "code": "CONFIRMATION_REQUIRED",
    "message": "This action requires explicit approval",
    "details": {}
  },
  "meta": {
    "request_id": "req_...",
    "timestamp": "2026-03-05T14:15:00Z"
  }
}
```

Common codes:
- `UNAUTHORIZED`
- `FORBIDDEN`
- `INVALID_REQUEST`
- `NOT_FOUND`
- `CONFLICT`
- `CONFIRMATION_REQUIRED`
- `ACTION_FAILED`
- `INTERNAL_ERROR`

---

## 10) Safety Rules (Normative)

The following operations MUST require confirmation before execution:
- reboot scheduling
- bootc rollback
- bootc apply stage
- stopping/disabling/removing active services
- network operations that may disconnect current session

All confirmation decisions MUST be audit logged with:
- actor/session
- action id
- decision
- timestamp

---

## 11) HATEOAS Decision (v0.1)

## Question
Should Bloom implement textbook HATEOAS strictly?

## Decision
Use **pragmatic hypermedia**, not strict textbook HATEOAS, in v0.1.

### Why
- This is an internal product protocol (UI + bridge developed together).
- Strict HATEOAS increases implementation cost and slows delivery.
- We still want discoverability and evolvability.

### What we do now
- Include top-level `links` in API root.
- Include per-resource `links.self` and relevant transitions when useful.
- Keep stable documented endpoints for simplicity.

### What we defer
- Full hypermedia forms/affordances for every state transition.
- Client that works with zero hardcoded endpoint knowledge.

### Upgrade path
If external clients/integrations grow, move toward HAL/JSON:API-style affordances in v1.x.

---

## 12) Versioning & Compatibility

- Path versioning: `/api/v1`
- Event schema version indicated by `protocol_version`
- Additive fields are backward-compatible
- Breaking changes require `/api/v2`

---

## 13) First End-to-End Flow (reference)

1. UI calls `POST /api/v1/actions` with `os.update.check`
2. Server returns `202` + action id
3. WS emits `action.created`, then `action.updated` (`running` -> `succeeded`)
4. UI timeline updates in real time

For a sensitive action (`os.update.apply`):
1. Action enters `waiting_confirmation`
2. WS emits `confirmation.requested`
3. UI posts decision to `/api/v1/confirmations/{id}`
4. Action proceeds or terminates based on decision

---

## 14) Implementation Notes

- Keep protocol messages compact and explicit.
- Prefer append-only action/event history for troubleshooting.
- Correlate logs with `request_id`, `action_id`, and `event_id`.
- Reuse existing Bloom tools under the hood; protocol is orchestration, not a duplicate control plane.
