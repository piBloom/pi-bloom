---
name: syncthing
version: 0.1.0
description: Peer-to-peer file sync for your home directory via Syncthing
image: docker.io/syncthing/syncthing@sha256:1feffa2d4826b48f25faefed093d07c5f00304d7e7ac86fd7cda334d22651643
---

# Syncthing Service

Synchronizes your home directory across your devices using Syncthing.
Device-specific directories are excluded via `~/.stignore`.

## Access UI

```bash
http://localhost:8384
```

## Initial Setup

1. Start service: `systemctl --user start bloom-syncthing`
2. Open Web UI at `http://localhost:8384`
3. Add remote device IDs
4. Confirm folder points to `/var/syncthing/home` (mapped from `$HOME`)
5. Approve sharing on peer devices

## Customizing `.stignore`

Bloom seeds `~/.stignore` with sensible defaults (excluding `.ssh`, `.gnupg`, `.cache`, etc.).
Edit `~/.stignore` to add your own exclusions. See: https://docs.syncthing.net/users/ignoring.html

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
- Home directory is bind-mounted from `$HOME`
- In VM setups, access the UI from host via QEMU port-forwarding or SSH tunnel to guest `localhost:8384`
