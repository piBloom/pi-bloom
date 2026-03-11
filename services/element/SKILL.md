---
name: element
version: 0.1.0
description: Matrix bridge for Pi messaging via matrix-bot-sdk
image: localhost/bloom-element:latest
---

# Element Bridge

Bridges Pi to the Matrix network via the local Continuwuity homeserver. Pi appears as `@pi:bloom` and auto-joins rooms when invited.

## Overview

Users message Pi from any Matrix client. The bridge forwards messages to Pi via the bloom-channels Unix socket protocol and returns responses.

## Setup

1. Matrix server must be running: `systemctl --user status bloom-matrix`
2. Install: `service_install(name="element")`
3. Pair: `service_pair(name="element", username="alex")` — auto-creates user + bot accounts, returns login credentials

## Send a message

Use `/matrix` command or message `@pi:bloom` from any Matrix client.

## Media

Incoming media (images, audio, video, files) is downloaded to `/var/lib/bloom/media/` and forwarded to Pi for processing.

## Troubleshooting

- Logs: `journalctl --user -u bloom-element -n 100`
- Status: `systemctl --user status bloom-element`
- Restart: `systemctl --user restart bloom-element`
- If Matrix login fails: check `~/.config/bloom/element.env` has correct `BLOOM_MATRIX_PASSWORD`
