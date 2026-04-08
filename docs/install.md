---
title: Install NixPI
description: Install NixPI on a fresh headless OVH VPS with nixos-anywhere.
---

# Install NixPI

## Supported target

- headless x86_64 VPS
- provider rescue-mode access
- SSH access to the rescue environment
- outbound internet access during installation

## Canonical install path

Use the dedicated [OVH Rescue Deploy](./operations/ovh-rescue-deploy) runbook.

NixPI currently supports one install story: deploy a fresh headless VPS with `nixos-anywhere` into the final host configuration directly.

No first-boot repo clone or generated flake step is part of the intended install convergence path.
Bootstrap and steady-state behavior belongs in NixOS config, not user-home markers.

## After install

Validate the installed host:

```bash
systemctl status nixpi-app-setup.service
systemctl status sshd.service
systemctl status wireguard-wg0.service
systemctl status nixpi-update.timer
wg show wg0
```

Routine rebuilds should use the installed host flake:

```bash
sudo nixpi-rebuild
```

The installed `/etc/nixos` flake remains the source of truth for the running host.

If you keep the conventional `/srv/nixpi` operator checkout, use the opinionated sync helper:

```bash
sudo nixpi-rebuild-pull [branch]
```

That helper syncs a remote branch into the conventional `/srv/nixpi` operator checkout before rebuilding from it.

`/srv/nixpi` is just a conventional operator checkout path. It is not required for first boot or install convergence.

Rollback if needed:

```bash
sudo nixos-rebuild switch --rollback
```

## Next steps

- [Operations](./operations/)
- [OVH Rescue Deploy](./operations/ovh-rescue-deploy)
- [First Boot Setup](./operations/first-boot-setup)
- [Reference](./reference/)
