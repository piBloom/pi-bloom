# Runtime Architecture

> Detailed documentation of the current shell-first NixPI runtime

## Why The Runtime Exists

NixPI uses a simpler runtime model:

- `nixpi-app-setup.service` seeds the Pi runtime state
- SSH and local login shells provide operator entry
- interactive login shells stay in a plain shell
- Pi is launched as a normal command from that shell

This keeps the runtime inspectable and avoids a separate browser transport layer.

## How The Runtime Works

| File | Purpose |
|------|---------|
| `core/os/modules/app.nix` | Pi runtime install and environment wiring |
| `core/os/modules/shell.nix` | Shell integration and user-session support |
| `core/os/pkgs/pi/default.nix` | Packaged Pi command |

## Runtime Behavior

At startup:

1. `nixpi-app-setup.service` ensures the Pi runtime state exists under `~/.pi`
2. `sshd.service` and local terminals remain available for operator entry
3. interactive operator sessions stay in a plain shell
4. Pi remains available as a direct command in that shell

## Failure Behavior

- if SSH is unavailable, a local terminal remains the fallback on monitor-attached hardware
- if Pi state is missing or inconsistent, inspect `~/.pi/` and rerun `pi`
