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
- `bootc_status` — current booted image / staged update state
- `bootc_update` — check/download/apply updates
- `bootc_rollback` — rollback staged image
- `container_status` — running `bloom-*` containers
- `container_logs` — recent logs for a Bloom service
- `systemd_control` — start/stop/restart/status for Bloom user services
- `container_deploy` — `daemon-reload` + start for a Bloom Quadlet unit

## Standard Triage Flow

1. Run `system_health`
2. If OS issue suspected: run `bootc_status`
3. If service issue suspected:
   - `container_status`
   - `systemd_control action=status`
   - `container_logs`
4. Apply minimal remediation (restart, redeploy, staged update) only with user approval
5. Re-run `system_health` to confirm recovery

## Health Signals

### Healthy
- `bloom-*` services active/running
- Containers running and not unhealthy
- `bootc_status` consistent with expected image state

### Unhealthy
- service failed / inactive unexpectedly
- container exited / unhealthy / restart loop
- update staged but reboot not yet applied

## Safety Rules

- Mutation operations require explicit user confirmation
- Only manage `bloom-*` services/containers
- Prefer user-scope service management (`systemctl --user`)
- Re-check health after every mutation
