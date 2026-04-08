# Runtime Flows

> End-to-end startup and operator-entry flow for the current NixPI runtime

## Active Runtime Path

1. `nixpi-app-setup.service` prepares `~/.pi`
2. `sshd.service` and local login shells provide operator entry
3. interactive operator sessions enter Zellij by default
4. the generated Zellij layout opens Pi and a plain shell workspace
5. Pi loads extensions, persona, and workspace state from the seeded runtime

## Boot and Service Startup Flow

```text
multi-user.target
├─ sshd.service
├─ wireguard-wg0.service
├─ nixpi-app-setup.service
└─ nixpi-update.timer
```

## Key Files

| File | Role |
|------|------|
| `core/os/modules/app.nix` | Pi runtime install and state-directory setup |
| `core/os/modules/shell.nix` | Shell-facing environment wiring |
| `core/pi/extensions/os/` | OS and update tooling exposed to Pi |

## Important Runtime Properties

- SSH and local terminals are the supported interactive entrypoints
- Zellij is the default interactive terminal UI
- Pi remains the main workflow inside the generated layout
- `~/.pi` is seeded before the operator starts work
- `/srv/nixpi` remains the canonical editable checkout for rebuilds

## Default Terminal UI

Interactive SSH and local tty logins pass through the NixPI terminal-ui launcher. When enabled, the launcher starts Zellij with the generated NixPI layout, opening Pi and a plain shell. Set `NIXPI_NO_ZELLIJ=1` to bypass the launcher and stay in a plain shell.

## Verification Commands

```bash
systemctl status nixpi-app-setup.service
systemctl status sshd.service
systemctl status wireguard-wg0.service
systemctl status nixpi-update.timer
command -v pi
pi --help
```
