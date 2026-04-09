# Service Architecture

> Built-in service surface and terminal interfaces

## Current Model

NixPI ships its operator-facing runtime directly from the base NixOS system. The current built-in service set is:

| Service | Purpose |
|---------|---------|
| `nixpi-app-setup.service` | Seeds the Pi runtime state under `~/.pi` |
| `sshd.service` | Remote shell access |

## Operational Notes

- SSH and local terminals are the supported operator entrypoints
- NixPI uses a plain shell runtime for interactive SSH and local tty sessions
- The Pi runtime remains available as a direct command inside that shell
- Use `systemctl status nixpi-app-setup.service` and `sshd.service` for baseline host-level inspection
- Check `sshd -T` and `nft list ruleset` when validating the SSH hardening policy
