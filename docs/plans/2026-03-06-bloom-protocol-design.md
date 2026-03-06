# Bloom Protocol Design

> Status: **Draft** — for assessment, not yet approved for implementation.
> Supersedes: `docs/headless-web-ui-plan.md` and `docs/ui-protocol.md` (if adopted)

## Problem

Bloom has multiple communication surfaces — Pi TUI, WhatsApp bridge, future web admin, future mobile app — each with different transport needs. Today these use ad-hoc protocols (Unix socket JSON-newline for channels, file-based Garden vault, no HTTP API). There is no common abstraction for how clients interact with Bloom.

## Core Principle

A **transport-agnostic message protocol** with HATEOAS semantics. Every message — whether carried over Unix socket, HTTP, or WebSocket — uses the same envelope. Responses include links and actions so clients know what they can do next without hardcoding URL paths or command names.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Protocol level | Message envelope, not transport | Bridges keep Unix sockets, web uses HTTP. The abstraction is the message format. |
| Hypermedia format | Lightweight JSON envelope with `links` | Siren is overkill for a single-user system with controlled clients. Plain JSON with optional links captures 80% of the value. |
| HTTP server | `node:http` (zero dependencies) | Fits Bloom's minimal-dependency philosophy. Sufficient for a local server. |
| Authentication | None — localhost binding | Tailscale handles remote access security. Auth can be added later at the transport layer without changing the protocol. |
| Content negotiation | HTML for browsers, JSON for programmatic clients | htmx consumes HTML directly. Bridges consume JSON. Same resource, different representations. |
| UI rendering | Pi-designed templates hydrated with live data | Pi generates/evolves templates stored in Garden. The HTTP server renders them with current data. Fast responses, AI-driven design. |
| Bridge transport | Unix socket stays | The current channel protocol has backpressure, rate limiting, and heartbeats that HTTP+SSE cannot replicate. Bridges stay on sockets; the API is a window into channels, not a replacement. |
| Domain core extraction | Not needed | Most extension logic is imperative I/O (shell calls). Pure functions already live in `lib/`. The API extension calls system commands directly, same as existing extensions. |

## Message Envelope

```typescript
interface BloomMessage {
  type: "request" | "response" | "event";
  resource: string;              // e.g. "/channels/whatsapp", "/services"
  action?: string;               // e.g. "send", "stop", "create"
  data?: unknown;                // payload
  links?: BloomLink[];           // HATEOAS: what can you do next
  meta?: Record<string, unknown>; // correlation IDs, timestamps, etc.
}

interface BloomLink {
  rel: string;       // e.g. "self", "collection", "reply", "stop"
  resource: string;  // target resource path
  action?: string;   // action name if applicable
  title?: string;    // human-readable label
}
```

### Example: Bridge sends a message

```json
{
  "type": "request",
  "resource": "/channels/whatsapp/messages",
  "action": "send",
  "data": { "from": "+1234567890", "body": "hello" },
  "meta": { "id": "msg-uuid-123" }
}
```

### Example: Bloom responds

```json
{
  "type": "response",
  "resource": "/channels/whatsapp/messages/msg-uuid-123",
  "data": { "body": "Hi! How can I help?" },
  "links": [
    { "rel": "channel", "resource": "/channels/whatsapp" },
    { "rel": "reply", "resource": "/channels/whatsapp/messages", "action": "send" }
  ],
  "meta": { "id": "msg-uuid-123", "ts": "2026-03-06T14:00:00Z" }
}
```

A simple bridge can ignore `links` entirely. A sophisticated client uses them for navigation and discovery.

## Transport Mapping

The same `BloomMessage` envelope is carried differently depending on transport:

| Transport | Mapping |
|-----------|---------|
| **Unix socket** | JSON-newline framing (evolves current channel protocol to use the standard envelope) |
| **HTTP** | `resource` maps to URL path, `action` maps to HTTP method, `data` maps to request/response body, `links` map to `_links` in JSON or `<a>`/`<button>` in HTML |
| **SSE** | Server pushes `type: "event"` messages as `data:` lines |
| **WebSocket** | JSON frames (future) |

## Architecture

```
Clients:       WhatsApp Bridge    htmx Web (future)    Hyperview Mobile (future)
                     |                  |                        |
Transport:     Unix socket           HTTP + SSE              HTTP / HXML
                     |                  |                        |
                     +--------+---------+------------------------+
                              |
                    BloomMessage Protocol
                              |
Extension:            bloom-api (Pi extension)
                     /        |         \
              protocol/   transports/   renderers/
              types &     http.ts       html.ts (templates)
              links       socket.ts     json.ts
                              |         hxml.ts (future)
                          handlers/
                          resource handlers
                          (call system commands directly)
                              |
Backend:          Garden    Services    OS/systemd    Channels
```

### bloom-api Extension Structure

```
bloom-api extension
  protocol/          BloomMessage types, serialization, link builders
  transports/
    http.ts          node:http server, routing, content negotiation
    socket.ts        Unix socket adapter (evolves bloom-channels envelope)
  renderers/
    html.ts          Hydrates Pi-designed templates with live data
    json.ts          JSON with _links
    hxml.ts          Hyperview XML output (future)
  handlers/          Resource handlers — call system commands directly
```

### Pi-Designed Templates

- Pi generates and evolves HTML templates stored in `~/Garden/Bloom/UI/`
- Templates sync across devices via Syncthing (same as persona and skills)
- `bloom-api` hydrates templates with live data at request time
- Pi evolves its own UI through the same self-evolution mechanism as persona
- Template format TBD — could be simple HTML with placeholder markers, or a lightweight template syntax

## Resource Map

| Resource | Path | Actions | Notes |
|----------|------|---------|-------|
| API root | `/` | — | Links to all top-level resources |
| System | `/system` | `reboot`, `update` | System health and status |
| Services | `/services` | `install` | List all services |
| Service | `/services/:name` | `start`, `stop`, `restart`, `remove` | Individual service |
| Channels | `/channels` | — | List connected channels + status |
| Channel | `/channels/:name` | — | Channel details |
| Messages | `/channels/:name/messages` | `send` | Inbound/outbound messages |
| Events | `/events` | — | SSE stream of system events |
| Channel events | `/channels/:name/events` | — | SSE stream for a specific channel |
| Garden | `/garden` | `reindex` | Garden vault overview |
| Objects | `/garden/objects` | `create` | PARA-organized objects |
| Object | `/garden/objects/:id` | `update`, `move`, `link` | Individual object |
| Journal | `/journal` | `write` | Journal entries |
| Journal entry | `/journal/:date` | — | Specific day |

## Implementation Phases

### Phase 1 — Protocol + HTTP Transport

- Define `BloomMessage` types in `protocol/`
- Create `bloom-api` extension with `node:http` server (localhost only)
- Implement `GET /health`, `GET /`, `GET /services` with content negotiation (HTML + JSON)
- SSE stream at `GET /events` for live system events
- Exit criteria: open a browser, see Bloom system status updating in real time

### Phase 2 — Socket Envelope Migration

- Evolve `bloom-channels` to use `BloomMessage` envelope over Unix socket
- Version the protocol so existing bridges continue working during transition
- Update WhatsApp bridge to new envelope format
- Exit criteria: WhatsApp bridge speaks BloomMessage over Unix socket

### Phase 3 — More Resources

- Garden objects (read-only first, then CRUD)
- Journal read/write
- Service actions (start, stop, install) with confirmation flow
- Channel visibility (status, recent messages, send-through)
- Audit logging for all API-initiated actions
- Exit criteria: all major Bloom capabilities accessible through the protocol

### Phase 4 — UI Clients

- htmx admin page consuming HTML responses from bloom-api
- Pi-designed template system — initial template set, evolution mechanism
- Hyperview mobile exploration
- Exit criteria: functional web admin for service management and garden browsing

## Architect Review Notes

The following concerns were raised during design review and should be addressed during implementation:

1. **SSE limitations**: SSE is unidirectional and lacks backpressure. Suitable for browser clients but not for bidirectional bridge communication. Design event emission as an internal concern that can be delivered over multiple transports.

2. **Auth will eventually be needed**: When exposing the API beyond localhost (even via Tailscale), consider a pairing mechanism or token-based auth at the transport layer. The protocol itself stays auth-agnostic.

3. **No over-abstraction**: The API extension should call system commands directly (same as bloom-os, bloom-services). Do not create a domain core abstraction layer — extract shared code into `lib/` only when actual duplication emerges.

4. **Existing docs**: If this design is adopted, `docs/headless-web-ui-plan.md` and `docs/ui-protocol.md` should be marked as superseded with a pointer to this document.

## Open Questions

- Template format: What syntax for Pi-designed templates? Simple HTML with markers? Mustache/Handlebars-style? Something custom?
- Port: What port does the HTTP server bind to? Suggest a well-known default (e.g., `18800`).
- How does the htmx admin page bootstrap? Served by bloom-api itself, or a separate static file?
- Should the `BloomMessage` envelope include a `version` field for future protocol evolution?
- How granular should SSE events be? Per-resource subscriptions, or a single firehose?
