---
name: matrix
version: 0.1.0
description: Continuwuity Matrix homeserver (self-hosted, no federation)
image: forgejo.ellis.link/continuwuation/continuwuity:latest
---

# Matrix Homeserver

Self-hosted Continuwuity Matrix server for private messaging with Pi.

## Overview

Bloom runs its own Matrix homeserver locally. Users register with any Matrix client (Element, FluffyChat, etc.) and message Pi directly. No data leaves the device. No federation — fully private.

## Setup

The Matrix server starts automatically. To register a user account:

1. A registration token is generated during setup: `~/.config/bloom/matrix.env`
2. Open your Matrix client, set homeserver to `http://<bloom-ip>:6167`
3. Register with the token

## Configuration

- Server name: `bloom`
- Port: `6167`
- Registration: token-required (see `~/.config/bloom/matrix.env`)
- Federation: disabled
- Data: persisted in `bloom-matrix-data` volume

## Troubleshooting

- Logs: `journalctl --user -u bloom-matrix -n 100`
- Status: `systemctl --user status bloom-matrix`
- Restart: `systemctl --user restart bloom-matrix`
