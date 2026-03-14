---
name: os-operations
description: Inspect, manage, and remediate the Bloom OS system — bootc status, services, containers, and timers
---

# OS Operations Skill

Use this skill when the user asks about Bloom OS health/state, or when an error suggests infrastructure inspection.

## Bloom OS Architecture

Bloom runs on **Fedora bootc 42** (immutable, image-based):

- `/usr` — immutable OS content, updated via bootc image upgrades
- `/etc` — host configuration
- `/var` — persistent runtime/user state

Bloom services are **user Quadlet units** managed by `systemd --user`:

- Unit files: `~/.config/containers/systemd/`
- Typical control path: `systemctl --user ...`

## Use Tools First (preferred)

Prefer Bloom extension tools over raw shell commands:

- `system_health` — broad health snapshot
- `bootc(action)` — status, check, download, apply, rollback for OS image
- `container(action)` — status, logs, deploy for bloom-* containers
- `systemd_control` — start/stop/restart/status for Bloom user services
- `manifest_show` / `manifest_sync` / `manifest_set_service` / `manifest_apply` — declarative service state management

## Standard Triage Flow

1. Run `system_health`
2. If OS issue suspected: run `bootc(action="status")`
3. If service issue suspected:
   - `container(action="status")`
   - `systemd_control action=status`
   - `container(action="logs")`
4. Apply minimal remediation (restart, redeploy, staged update) only with user approval
5. Re-run `system_health` to confirm recovery

## Health Signals

### Healthy
- `bloom-*` services active/running
- Containers running and not unhealthy
- `bootc(action="status")` consistent with expected image state

### Unhealthy
- service failed / inactive unexpectedly
- container exited / unhealthy / restart loop
- update staged but reboot not yet applied

## Safety Rules

- Mutation operations require explicit user confirmation
- Only manage `bloom-*` services/containers
- Prefer user-scope service management (`systemctl --user`)
- Re-check health after every mutation
