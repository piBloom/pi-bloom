# Service Architecture

> Built-in service surface and terminal interfaces

## Audience

Maintainers and operators deciding how NixPI exposes user-facing services.

## Current Model

NixPI ships its operator-facing surface directly from the base NixOS system. The Pi terminal surface, browser ttyd transport, and supporting network services are part of the same host deployment.

## Built-In Services

The current built-in service set is:

| Service | Port | Purpose |
|---------|------|---------|
| `nginx` | `:80`, `:443` | Public entrypoint for the Pi terminal surface |
| `nixpi-ttyd.service` | proxied via `/` and `/terminal/` | Browser terminal session |
| `wireguard-wg0.service` | native WireGuard | Required remote-access and firewall trust boundary |

These services are declared in the OS layer and are expected to exist on every deployed NixPI host.

## Operational Notes

- The public operator surface is `/`, with `/terminal/` as an alias to the same ttyd session.
- Use `systemctl status nixpi-ttyd.service`, `nginx.service`, and `wireguard-wg0.service` for host-level inspection.
- Use `journalctl -u <unit>` when you need service logs during deployment or troubleshooting.

## Related

- [Daemon Architecture](./daemon-architecture)
- [Infrastructure](./infrastructure)
- [First Boot Setup](../operations/first-boot-setup)
