---
name: os-operations
description: Inspect, manage, and remediate the nixPI system — NixOS updates, local proposal validation, services, and timers
---

# OS Operations Skill

Use this skill when the user asks about Workspace OS health/state, or when an error suggests infrastructure inspection.

## Workspace OS Architecture

Workspace runs on **NixOS** (declarative, flake-based):

- `/run/current-system` — immutable OS content, updated via `nixos-rebuild switch`
- `/etc` — generated host configuration
- `/var` — persistent runtime/user state

Workspace services are **systemd units** managed by `systemd` (system) and `systemd --user` (Pi agent).

## Use Tools First

Prefer Workspace extension tools over raw shell commands:

- `system_health` — broad health snapshot
- `nixos_update(action, source)` — status, apply from `remote` or `local`, rollback for NixOS generation
- `nix_config_proposal(action)` — inspect the local proposal repo, validate Nix config, or refresh `flake.lock`
- `systemd_control` — start/stop/restart/status for Workspace user services

## Standard Triage Flow

1. Run `system_health`
2. If OS issue suspected: run `nixos_update(action="status")`
3. If a local Nix change is being prepared: run `nix_config_proposal(action="status")` and `nix_config_proposal(action="validate")`
4. If service issue suspected: run `systemd_control action=status`
5. Apply minimal remediation only with user approval
6. Re-run `system_health` to confirm recovery

## Health Signals

### Healthy

- `nixpi-*` services active/running
- `nixos_update(action="status")` shows current generation is booted

### Unhealthy

- service failed / inactive unexpectedly
- update staged but reboot not yet applied

## Safety Rules

- mutation operations require explicit user confirmation
- only manage `nixpi-*` services
- prefer user-scope service management (`systemctl --user`)
- re-check health after every mutation
