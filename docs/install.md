---
title: Install NixPI
description: Install NixPI on a NixOS-capable x86_64 machine.
---

# Install NixPI

## Requirements

- NixOS-capable x86_64 machine: VPS, headless VM, or mini PC with an attached monitor
- SSH access with `sudo`
- Outbound internet access

## Install command

```bash
nix --extra-experimental-features 'nix-command flakes' run github:alexradunet/nixpi#nixpi-bootstrap-vps
```

Run the command as your normal user (do **not** prefix with `sudo`).
The bootstrap script escalates only the specific steps that need root.

If you want to force the freshest copy from GitHub (skip flake fetch cache), use:

```bash
nix --extra-experimental-features 'nix-command flakes' run --refresh github:alexradunet/nixpi?ref=main#nixpi-bootstrap-vps
```

The bootstrap process prepares `/srv/nixpi`, initializes a host-owned flake in `/etc/nixos`, and runs:

```bash
sudo nixos-rebuild switch --flake /etc/nixos --impure
```

On a monitor-attached mini PC, the installed system also keeps a local `tty1` login prompt after reboot, so local recovery remains available if remote access is unavailable.

## After install

Operate from the canonical checkout:

```bash
cd /srv/nixpi
git fetch origin
git rebase origin/main
sudo nixos-rebuild switch --flake /etc/nixos --impure
```

Check core services:

```bash
systemctl status nixpi-chat.service
systemctl status nixpi-ttyd.service
systemctl status nginx.service
systemctl status netbird.service
```

Rollback if needed:

```bash
sudo nixos-rebuild switch --rollback
```

## Next steps

- [Operations](./operations/)
- [First Boot Setup](./operations/first-boot-setup)
- [Reference](./reference/)
