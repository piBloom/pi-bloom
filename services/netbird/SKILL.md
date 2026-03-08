---
name: netbird
version: native
description: Secure mesh networking via NetBird (system service)
---

# NetBird

EU-hosted mesh networking for secure remote access to your Bloom device. Uses NetBird cloud management (free tier, up to 5 peers).

NetBird provides the security layer for remote desktop (Xpra) and file access (dufs).

NetBird is installed as a native system service (not a container) because WireGuard requires real kernel-level CAP_NET_ADMIN.

## Setup

NetBird authentication is handled automatically during Bloom's login flow (before Pi starts). If you need to re-authenticate:

1. Check status: `sudo netbird status`
2. Authenticate: `sudo netbird up`
3. Follow the browser link to sign in at https://app.netbird.io

## Adding Peers

Install NetBird on your other devices (laptop, phone) from https://netbird.io/download and sign in with the same account. All devices on the same account can reach each other.

## Operations

- Status: `sudo netbird status`
- Logs: `sudo journalctl -u netbird -n 100`
- Stop: `sudo systemctl stop netbird`
- Start: `sudo systemctl start netbird`
