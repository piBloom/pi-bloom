# Runtime Flows

> End-to-end operator-entry flow for the target declarative NixPI runtime

## Install-Time Handoff

1. `nixos-anywhere` installs a plain base system.
2. After first login, the operator runs `nixpi-bootstrap-host` on the machine.
3. Bootstrap writes narrow `/etc/nixos` helper files and either generates a minimal host flake or prints exact manual integration instructions.
4. The system rebuild target remains `/etc/nixos#nixos`.

## Runtime Entry Flow

1. Boot selects bootstrap or steady-state behavior from declarative NixOS config.
2. `sshd.service` provides operator entry during bootstrap and steady state, restricted to configured admin CIDRs.
3. `nixpi-app-setup.service` exposes the Pi runtime entry path.
4. Interactive operator sessions stay in a plain shell.
5. Pi loads extensions, persona, and workspace state from the seeded runtime.

## Boot and Service Startup Flow

```text
multi-user.target
├─ sshd.service
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
- Interactive operator sessions stay shell-first
- Pi remains the main workflow inside the generated layout
- the machine starts from a plain base system before NixPI is layered on
- bootstrap writes narrow `/etc/nixos` helper files
- `/etc/nixos` is the only steady-state source of truth
- bootstrap and steady-state are selected declaratively rather than from user-home marker files
- shell behavior should come from NixOS modules rather than user-home mutation
- repo checkouts are not part of the supported convergence path

## Default Terminal Behavior

Interactive SSH and local tty logins stay in a plain shell. Pi is available directly as a command in that shell without an extra terminal UI layer.

## Verification Commands

```bash
systemctl status nixpi-app-setup.service
systemctl status sshd.service
systemctl status nixpi-update.timer
command -v pi
pi --help
```

```bash
sshd -T | grep -E 'passwordauthentication|permitrootlogin'
sudo nft list ruleset | grep 'dport 22'
```
