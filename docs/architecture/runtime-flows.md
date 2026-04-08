# Runtime Flows

> End-to-end operator-entry flow for the target declarative NixPI runtime

## Install-Time Handoff

1. `nixos-anywhere` installs the final host configuration directly.
2. The first boot hands off to the normal NixOS boot path with no repo-seeding step.

## Runtime Entry Flow

1. Boot selects bootstrap or steady-state behavior from declarative NixOS config.
2. `sshd.service` and `wireguard-wg0.service` provide operator entry.
3. `nixpi-app-setup.service` exposes the Pi runtime entry path.
4. Interactive operator sessions enter Zellij by default.
5. The generated Zellij layout opens Pi and a plain shell workspace.
6. Pi loads extensions, persona, and workspace state from the seeded runtime.

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
- No boot-time repo clone or generated host flake step is part of the intended runtime
- Bootstrap and steady-state are selected declaratively rather than from user-home marker files
- shell behavior should come from NixOS modules rather than user-home mutation
- an operator checkout such as `/srv/nixpi` is optional and separate from the deployed host configuration

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
