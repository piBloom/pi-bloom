# Channel Protocol

Bloom uses a JSON-over-Unix-socket bridge protocol for external messaging platforms.

## Connection

Bridges connect to the Unix socket:

- Default: `/run/bloom/channels.sock`
- Override: `BLOOM_CHANNELS_SOCKET`

All frames are newline-delimited JSON (`\n`-terminated).

## Authentication

Each channel must register with a token from:

- `~/.config/bloom/channel-tokens/{channel}`

If token is missing or invalid, registration is rejected.

## Message Format

### Bridge → Bloom

**Register**

```json
{"type":"register","channel":"whatsapp","token":"<hex-token>"}
```

**Incoming message**

```json
{"type":"message","id":"msg-123","channel":"whatsapp","from":"John","text":"Hello!","timestamp":1709568000}
```

**Incoming message with media**

```json
{
  "type": "message",
  "id": "msg-124",
  "channel": "whatsapp",
  "from": "John",
  "timestamp": 1709568000,
  "media": {
    "kind": "audio",
    "mimetype": "audio/ogg",
    "filepath": "/var/lib/bloom/media/1709568000-abc123.ogg",
    "duration": 15,
    "size": 24576,
    "caption": null
  }
}
```

**Pong**

```json
{"type":"pong","channel":"whatsapp"}
```

### Bloom → Bridge

**Status** (registration acknowledged)

```json
{"type":"status","connected":true}
```

**Ping** (heartbeat)

```json
{"type":"ping"}
```

**Response** (reply to a specific inbound message)

```json
{"type":"response","id":"msg-123","channel":"whatsapp","to":"John","text":"Hey John!"}
```

**Send** (outbound command from Pi, e.g. `/wa`)

```json
{"type":"send","channel":"whatsapp","text":"Hello from Bloom"}
```

**Error**

```json
{"type":"error","id":"msg-123","reason":"queue full"}
```

## Flow

1. Bridge connects to `/run/bloom/channels.sock`
2. Bridge sends `register` with channel token
3. Bloom replies `status`
4. Bridge sends inbound `message` events
5. Bloom replies with `response` events
6. Heartbeat: Bloom sends `ping`, bridge sends `pong`

## Current Bridges

- **WhatsApp (Baileys)** — channel `whatsapp`, deployed as a Podman Quadlet service
