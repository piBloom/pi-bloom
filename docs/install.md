---
title: Install NixPI
description: Install NixPI on a fresh headless OVH VPS with nixos-anywhere.
---

# Install NixPI

## Supported target

- headless x86_64 VPS
- provider rescue-mode access
- SSH access to the rescue environment
- outbound internet access during installation and first boot

## Canonical install path

Use the dedicated [OVH Rescue Deploy](./operations/ovh-rescue-deploy) runbook.

NixPI now supports a single install story: deploy a fresh headless VPS with `nixos-anywhere`, then operate the machine from `/srv/nixpi`.

## After install

Operate from the canonical checkout:

```bash
cd /srv/nixpi
git status
sudo nixpi-rebuild
sudo nixpi-rebuild-pull
```

Check core services:

```bash
systemctl status nixpi-app-setup.service
systemctl status sshd.service
systemctl status wireguard-wg0.service
systemctl status nixpi-update.timer
wg show wg0
```

Rollback if needed:

```bash
sudo nixos-rebuild switch --rollback
```

## Next steps

- [Operations](./operations/)
- [OVH Rescue Deploy](./operations/ovh-rescue-deploy)
- [First Boot Setup](./operations/first-boot-setup)
- [Reference](./reference/)
