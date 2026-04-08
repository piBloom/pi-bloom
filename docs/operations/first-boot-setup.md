# First Boot Setup

> Validating a fresh NixPI host after nixos-anywhere installation

## Audience

Operators bringing up a fresh NixPI headless VPS.

## Prerequisites

Before this checklist, you should already have:

1. a completed `nixpi-deploy-ovh` install
2. SSH access to the deployed host
3. the expected host flake target available in the operator checkout you plan to use for rebuilds, if any

## What First Boot Means Now

NixPI comes up as a shell-first host runtime with Zellij as the default interactive terminal UI.

A fresh system should provide:

- SSH access for the primary operator
- Zellij as the default interactive entrypoint on SSH and local tty sessions
- Pi runtime availability from the deployed system
- bootstrap versus steady-state mode from the deployed NixOS config
- an installed `/etc/nixos` flake that remains authoritative for host convergence
- a rebuild path that is explicit about which operator checkout, if any, you are using

## First-Boot Checklist

### 1. Verify the Base Services

```bash
systemctl status nixpi-app-setup.service
systemctl status sshd.service
systemctl status wireguard-wg0.service
systemctl status nixpi-update.timer
```

Expected result: all four services are active or activatable.

### 2. Verify the Runtime Entry Path

From SSH:

```bash
command -v pi
pi --help
ls -la ~/.pi
```

Expected result:

- the `pi` command is installed
- Pi is usable without any browser-only service layer
- user-home marker files are not the primary control plane for the host mode

After the first successful login, the default operator-facing interface is Zellij. The generated layout opens Pi and a shell tab. If you need a plain shell for recovery, use `NIXPI_NO_ZELLIJ=1` before starting the login shell.

### 3. Verify WireGuard Before Normal Use

```bash
systemctl status wireguard-wg0.service
wg show wg0
ip link show wg0
```

Expected result:

- `wireguard-wg0.service` is active
- `wg0` exists before you rely on the deployment as your preferred private operator path
- `wg show wg0` lists at least one peer once you have added your admin device

### 4. Optional: Verify the Operator Rebuild Path

First verify the standard rebuild path from the installed host flake:

```bash
sudo nixpi-rebuild
```

If you maintain the conventional `/srv/nixpi` operator checkout, verify the sync helper too:

```bash
sudo nixpi-rebuild-pull [branch]
```

This helper is specifically for syncing a remote branch into the conventional `/srv/nixpi` operator checkout before rebuilding from it.

If you maintain some other operator checkout for ongoing changes, verify that manual path-specific workflow separately. Use the path to that checkout, whether it lives outside `/srv/nixpi` or alongside it.

```bash
sudo nixos-rebuild switch --flake <checkout-path>#ovh-vps
```

Expected result:

- `sudo nixpi-rebuild` rebuilds from the installed host flake
- `sudo nixpi-rebuild-pull [branch]` syncs a remote branch into `/srv/nixpi` and rebuilds from that operator checkout
- manual `nixos-rebuild switch --flake <checkout-path>#ovh-vps` rebuilds from the explicitly selected checkout
- the deployed system stays independent from any boot-time repo seeding

## Operator Orientation

After first boot, keep these boundaries in mind:

- the deployed NixOS config owns bootstrap and steady-state behavior
- the installed `/etc/nixos` flake remains authoritative for the running host
- user-home marker files are not the control path for transitioning host state
- SSH sessions are the operator control plane, with Zellij as the default interactive UI
- an operator checkout such as `/srv/nixpi` is a workspace for review, sync, and rebuilds, not a first-boot requirement
- Shell behavior should already match the deployed NixOS configuration
- system services remain inspectable with normal NixOS and systemd tooling

## Reference

### Relevant Services

| Service | Purpose |
|------|---------|
| `nixpi-app-setup.service` | Provides the Pi runtime entry path |
| `sshd.service` | Remote shell access |
| `wireguard-wg0.service` | Compatibility control unit for the WireGuard management network |

### Current Behavior Target

- the machine boots to a normal headless multi-user target
- no desktop session is required to start operating NixPI
- the primary user workflow is Pi in the terminal, reached from SSH via Zellij by default
- updates run through native NixOS/systemd paths, `sudo nixpi-rebuild` targets the installed host flake, and manual rebuilds can target the explicit operator checkout you chose
