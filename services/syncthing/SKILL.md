---
name: syncthing
version: 0.1.0
description: Peer-to-peer file sync for the Garden vault via Syncthing
image: docker.io/syncthing/syncthing@sha256:1feffa2d4826b48f25faefed093d07c5f00304d7e7ac86fd7cda334d22651643
---

# Syncthing Service

Synchronizes `~/Garden` across your devices using Syncthing.

## Access UI

Open:

```bash
http://localhost:8384
```

## Initial Setup

1. Start service: `systemctl --user start bloom-syncthing`
2. Open Web UI at `http://localhost:8384`
3. Add remote device IDs
4. Confirm folder points to `/var/syncthing/Garden` (mapped from `~/Garden`)
5. Approve sharing on peer devices

## Common Commands

```bash
# Service state
systemctl --user status bloom-syncthing

# Follow logs
journalctl --user -u bloom-syncthing -f

# Check health endpoint
curl -sf http://localhost:8384/rest/noauth/health
```

## Notes

- Uses host networking for Syncthing discovery + transport ports
- Persistent state stored in `bloom-syncthing-data` volume
- Garden vault is bind-mounted from `%h/Garden`
- In VM setups, access the UI from host via QEMU port-forwarding or SSH tunnel to guest `localhost:8384`
