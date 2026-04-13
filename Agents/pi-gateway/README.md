# NixPI Pi Gateway

A small TypeScript gateway framework that connects transport modules to Pi through the local `pi-core` service.

Today the first module is Signal. Tomorrow it can be something less obsessed with QR codes.

## Architecture

- `pi-core` is the always-on local Pi service boundary
- `pi-gateway` is the generic channel ingress/egress layer
- transport modules normalize inbound messages and deliver replies
- `signal-cli` remains the native Signal transport daemon used by the Signal module

## Current module set

- `signal`

## Config shape

```yaml
gateway:
  dbPath: /absolute/path/to/gateway.db
  maxReplyChars: 1400
  maxReplyChunks: 4

piCore:
  socketPath: /run/nixpi-pi-core/pi-core.sock

modules:
  signal:
    enabled: true
    account: "+15550001111"
    httpUrl: http://127.0.0.1:8080
    allowedNumbers:
      - "+15550002222"
    adminNumbers:
      - "+15550002222"
    directMessagesOnly: true
```

## Runtime split

- `nixpi-pi-core.service` owns Pi SDK prompting and sessions
- `nixpi-gateway.service` runs the generic gateway core
- `nixpi-signal-daemon.service` runs native `signal-cli` for the Signal module
