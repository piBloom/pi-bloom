# First Boot Setup

> Validating a fresh NixPI host after nixos-anywhere installation

## Audience

Operators bringing up a fresh NixPI headless VPS.

## Prerequisites

Before this checklist, you should already have:

1. a completed `nixpi-deploy-ovh` install
2. the canonical checkout present at `/srv/nixpi`
3. a completed `sudo nixos-rebuild switch --flake /etc/nixos#nixos`

## What First Boot Means Now

NixPI comes up as a shell-first host runtime.

A fresh system should provide:

- SSH access for the primary operator
- Pi runtime state under `~/.pi`
- system management anchored in `/srv/nixpi`
- a generated `/etc/nixos/flake.nix` that keeps `#nixos` as the rebuild target

## First-Boot Checklist

### 1. Verify the Base Services

```bash
systemctl status nixpi-app-setup.service
systemctl status sshd.service
systemctl status wireguard-wg0.service
systemctl status nixpi-update.timer
```

Expected result: all four services are active or activatable.

### 2. Verify the Pi Runtime

From SSH:

```bash
command -v pi
pi --help
ls -la ~/.pi
```

Expected result:

- the `pi` command is installed
- `~/.pi/settings.json` exists
- Pi is usable without any browser-only service layer

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

### 4. Verify the Canonical Repo Flow

```bash
cd /srv/nixpi
git status
sudo nixpi-rebuild
```

Expected result: the machine rebuilds from `/etc/nixos` while importing NixPI from `/srv/nixpi`, preserving the host's existing hardware configuration.

## Operator Orientation

After first boot, keep these boundaries in mind:

- `/srv/nixpi` is the canonical git working tree for sync, review, and rebuilds
- `/etc/nixos` is the standard flake root used for system rebuilds
- SSH sessions are the operator control plane
- direct passwordless `sudo` is temporary during setup and is removed by `nixpi-setup-apply`
- system services remain inspectable with normal NixOS and systemd tooling

## Reference

### Relevant Services

| Service | Purpose |
|------|---------|
| `nixpi-app-setup.service` | Seeds the Pi runtime state |
| `sshd.service` | Remote shell access |
| `wireguard-wg0.service` | Compatibility control unit for the WireGuard management network |

### Current Behavior

- the machine boots to a normal headless multi-user target
- no desktop session is required to start operating NixPI
- the primary user workflow is Pi in the terminal, reached from SSH
- updates run through the native `nixos-upgrade.service` / `nixpi-update.timer` path, while manual rebuilds and rollbacks still come from `/srv/nixpi`
