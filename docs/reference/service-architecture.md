# Service Architecture

> Built-in service surface and web interfaces

## Audience

Maintainers and operators deciding how NixPI exposes user-facing services.

## Current Model

NixPI ships its operator-facing surface directly from the base NixOS system. The remote web app, browser terminal, backend chat runtime, and supporting network services are part of the same host deployment.

## Built-In Services

The current built-in service set is:

| Service | Port | Purpose |
|---------|------|---------|
| `nginx` | `:80`, `:443` | Public entrypoint for the web app and browser terminal |
| `nixpi-chat.service` | `127.0.0.1:8080` | Internal chat backend used by the web app |
| `nixpi-ttyd.service` | proxied via `/terminal/` | Browser terminal session |
| `wireguard-wg0.service` | native WireGuard | Required remote-access and firewall trust boundary |

These services are declared in the OS layer and are expected to exist on every deployed NixPI host.

## Operational Notes

- The public operator surface is `/` for chat and `/terminal/` for the browser terminal.
- `127.0.0.1:8080` is the internal backend probe, not the primary operator URL.
- Use `systemctl status nixpi-chat.service`, `nixpi-ttyd.service`, `nginx.service`, and `wireguard-wg0.service` for host-level inspection.
- Use `journalctl -u <unit>` when you need service logs during deployment or troubleshooting.

## Related

- [Daemon Architecture](./daemon-architecture)
- [Infrastructure](./infrastructure)
- [First Boot Setup](../operations/first-boot-setup)
