---
title: Install Plain Host
description: Install a standard NixOS host onto a fresh OVH VPS through the repo's plain-host deploy surface.
---

# Install Plain Host

## Supported target

- headless x86_64 VPS
- provider rescue-mode access
- SSH access to the rescue environment
- outbound internet access during installation

## Canonical install path

1. boot the VPS into provider rescue mode
2. run `nix run .#plain-host-deploy -- --target-host root@SERVER_IP --disk /dev/disk/by-id/PERSISTENT_TARGET_DISK_ID`
3. let `nixos-anywhere` install the plain `ovh-vps-base` system
4. reconnect to the installed host after first boot

This flow installs a standard NixOS host only. It does not bootstrap NixPI as part of the day-0 install.

## Run the install command

From a local checkout of this repo:

```bash
nix run .#plain-host-deploy -- \
  --target-host root@SERVER_IP \
  --disk /dev/disk/by-id/PERSISTENT_TARGET_DISK_ID
```

If you do not pass `--hostname`, the installed host keeps the default `nixos` hostname.

The install is destructive. It repartitions and reformats the selected target disk before installing the base host.

## Provider runbook

For the OVH-specific rescue workflow, disk-selection guidance, and staged `kexec` troubleshooting, use [OVH Rescue Deploy](./operations/ovh-rescue-deploy).

## Optional next step: bootstrap NixPI

After the base host exists and you can reconnect to it normally, NixPI can be layered later with [Bootstrap NixPI](./install) and `nixpi-bootstrap-host`.
