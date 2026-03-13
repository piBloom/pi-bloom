---
name: matrix
version: 0.1.0
description: Continuwuity Matrix homeserver (native OS service, no federation)
---

# Matrix Homeserver

Native Continuwuity Matrix server baked into the Bloom OS image.

## Overview

Bloom runs its own Matrix homeserver as a native systemd service (`bloom-matrix.service`). Users register with any Matrix client and message Pi directly. No data leaves the device. No federation — fully private.

## Setup

The Matrix server starts automatically on boot. User accounts are created during the first-boot setup:

1. Pi creates a bot account (`@pi:bloom`) automatically
2. Pi guides the user to register with their preferred Matrix client
3. User creates a DM with `@pi:bloom`

## Configuration

- Server name: `bloom`
- Port: `6167`
- Registration: token-required (see `/var/lib/continuwuity/registration_token`)
- Federation: disabled
- Data: `/var/lib/continuwuity/`

## Bridges

External messaging platforms (WhatsApp, Telegram, Signal) connect via mautrix bridge containers. Use Pi's `bridge_create` tool to set up bridges.

## Troubleshooting

- Logs: `journalctl -u bloom-matrix -n 100`
- Status: `systemctl status bloom-matrix`
- Restart: `sudo systemctl restart bloom-matrix`
- Reload (after appservice registration): `sudo systemctl reload bloom-matrix`
