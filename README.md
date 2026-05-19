# Ownloom infrastructure

This repository is organized by server/platform area.

## Repository map

```text
ARCHITECTURE.md  # Always-current Mermaid architecture and flow reference
infra/  # Active NixOS flake for Proxmox-hosted guests
proxmox/  # Proxmox VE host documentation, runbooks, and future host automation
nazar_backup/  # Previous Nazar NixOS flake, modules, service code, docs, and runbooks
```

## Proxmox

The active server at `167.235.12.22` is now a Proxmox VE host named `proxmox`.

Start here:

```text
ARCHITECTURE.md
proxmox/runbooks/PROXMOX_INSTALLATION.md
proxmox/runbooks/PHASE_1_COMPLETION.md
proxmox/runbooks/PHASE_2_EDGE_REVERSE_PROXY.md
proxmox/runbooks/PHASE_3_DNS_HTTPS_CUTOVER.md
proxmox/runbooks/PHASE_4_PRIVATE_ACCESS_RESEARCH.md
proxmox/runbooks/PHASE_4_HEADSCALE_INTEGRATION.md
proxmox/runbooks/PHASE_5_SUBNET_ROUTING.md
```

Current public endpoints:

```text
https://nazar.studio/
https://headscale.nazar.studio/health
```

Preferred SSH access from this laptop:

```bash
ssh proxmox
```

Break-glass root access:

```bash
ssh proxmox-root
```

## Nazar NixOS backup/configuration

The prior NixOS configuration has been moved under:

```text
nazar_backup/
```

Use the flake from that directory:

```bash
cd nazar_backup
nix flake check
nix run .#switch-host
```

Note: the physical server was reinstalled as Proxmox VE on 2026-05-19, so the Nazar NixOS configuration is no longer the active host OS unless intentionally redeployed.

## Architecture diagram maintenance

Keep `ARCHITECTURE.md` updated in the same commit as any infrastructure change that affects topology, DNS, public exposure, private networking, Caddy routes, Tailnet flows, VM inventory, or deployment source of truth.
