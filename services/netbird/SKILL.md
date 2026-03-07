---
name: netbird
version: "0.1.0"
description: Secure mesh networking via NetBird (EU-hosted)
image: netbirdio/netbird@sha256:b3e69490e58cf255caf1b9b6a8bbfcfae4d1b2bbaa3c40a06cfdbba5b8fdc0d2
---

# NetBird

EU-hosted mesh networking for secure remote access to your Bloom device.

## Setup

1. Install: `just svc-install netbird`
2. Authenticate: `podman exec bloom-netbird netbird up`
3. Check status: `podman exec bloom-netbird netbird status`
4. Management dashboard: https://app.netbird.io

## Operations

- Logs: `journalctl --user -u bloom-netbird -n 100`
- Stop: `systemctl --user stop bloom-netbird`
- Start: `systemctl --user start bloom-netbird`
