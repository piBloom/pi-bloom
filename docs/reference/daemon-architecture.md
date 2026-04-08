# Daemon Architecture

> Detailed documentation of the NixPI terminal-first runtime

## Why The Runtime Exists

NixPI now uses a simpler runtime model:

- nginx exposes ttyd at `/`
- ttyd launches a dedicated NixPI terminal bootstrap wrapper
- the wrapper drops the operator straight into `pi`

This keeps the browser transport simple and lets Pi remain the actual interface.

## How The Runtime Works

The active runtime path is built from:

| File | Purpose |
|------|---------|
| `core/os/modules/ttyd.nix` | ttyd systemd service and environment wiring |
| `core/scripts/nixpi-terminal-bootstrap.sh` | terminal bootstrap wrapper that enters `pi` |
| `core/os/modules/service-surface.nix` | nginx routing of `/` and `/terminal/` to ttyd |
| `core/os/modules/app.nix` | Pi runtime install and state-directory setup |

## Runtime Behavior

At startup:

1. `nixpi-app-setup.service` ensures the Pi runtime state exists under `~/.pi`
2. `nixpi-ttyd.service` starts ttyd on `127.0.0.1:7681`
3. nginx proxies `/` and `/terminal/` to ttyd
4. the terminal bootstrap wrapper enters `pi` in the user's NixPI workspace

## Reference

### Important Current Failure Behavior

- ttyd startup is single-shot; systemd restart policy handles crashes
- if the browser transport fails, the same Pi flow remains available from SSH or a local terminal

## Related

- [Service Architecture](./service-architecture)
- [Architecture](../architecture/)
