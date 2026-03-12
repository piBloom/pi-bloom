---
name: bridges
description: How Pi manages Matrix bridges to external messaging platforms
---

# Matrix Bridges

You can bridge external messaging platforms to your local Matrix homeserver. Each bridge runs as a Podman container managed by Pi.

## Available Bridges

| Platform | Protocol | Auth Method |
|----------|----------|-------------|
| WhatsApp | whatsapp | QR code scan |
| Telegram | telegram | Phone number + code |
| Signal | signal | QR code scan |

## Creating a Bridge

Use `bridge_create(protocol)` to set up a bridge. Pi will:
1. Pull the bridge container image
2. Configure it to connect to the local Continuwuity homeserver
3. Start it as a systemd service
4. Guide you through authentication

## Authentication

After creating a bridge, open the gateway at `http://<hostname>:18810/` and look for the bridge bot room. Follow the bot's instructions:
- **QR code bridges** (WhatsApp, Signal): Scan the QR code with your phone
- **Phone code bridges** (Telegram): Enter your phone number, then the verification code

## Managing Bridges

- `bridge_status()` -- List active bridges and their connection status
- `bridge_remove(protocol)` -- Stop and remove a bridge

## How It Works

Bridges connect external platforms to Matrix rooms. When someone messages you on WhatsApp, the bridge creates a Matrix room for that conversation. You see and reply to messages in the Cinny web client (via the gateway) or any Matrix client. Pi can also read and respond in these rooms.
