---
name: builtin-services
description: Reference for NixPI's built-in user-facing services that are always available on every node
---

# Built-In Services

NixPI ships these services as part of the base NixOS system. They are not optional packages and they do not need to be installed from the repo.

## Always Available

- `NixPI Terminal` behind the canonical web entry point at `/`

## Operational Notes

- This surface is managed as a declarative systemd service plus nginx proxying
- Use `systemd_control` for status, restart, and stop/start operations
- It should be treated as a stable base OS capability, not as an optional service package

## Expected Unit Names

- `nixpi-ttyd`

## URLs

Preferred access is over WireGuard:

- `https://<wireguard-host>/`

Localhost remains valid on the machine itself:

- `http://localhost/`
