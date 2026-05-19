# Ownloom infrastructure

This repository is organized by server/platform area.

## Repository map

```text
proxmox/  # Proxmox VE host documentation, runbooks, and future host automation
nazar/    # Previous Nazar NixOS flake, modules, service code, docs, and runbooks
```

## Proxmox

The active server at `167.235.12.22` is now a Proxmox VE host named `proxmox`.

Start here:

```text
proxmox/runbooks/PROXMOX_INSTALLATION.md
```

Preferred SSH access from this laptop:

```bash
ssh proxmox
```

Break-glass root access:

```bash
ssh proxmox-root
```

## Nazar NixOS archive/configuration

The prior NixOS configuration has been moved under:

```text
nazar/
```

Use the flake from that directory:

```bash
cd nazar
nix flake check
nix run .#switch-host
```

Note: the physical server was reinstalled as Proxmox VE on 2026-05-19, so the Nazar NixOS configuration is no longer the active host OS unless intentionally redeployed.
