# Bloom First-Boot Setup

> 📖 [Emoji Legend](LEGEND.md)

Bloom's first-boot experience is split into two phases.

## Phase 1: Bash Wizard

`bloom-wizard.sh` handles deterministic machine setup on first interactive login.

Current responsibilities:

1. password change and basic connectivity checks
2. NetBird enrollment
3. primary Matrix account bootstrap
4. Git identity setup
5. optional bundled service choices

The wizard writes completion state under `~/.bloom/` and hands control back to Pi when finished.

## Phase 2: Pi Persona Step

After the wizard is complete, `bloom-setup` tracks a single Pi-side setup step:

- `persona`

That step is recorded in `~/.bloom/setup-state.json` and completed when Pi finishes the persona customization flow.

Relevant files:

| Path | Purpose |
|------|---------|
| `~/.bloom/.setup-complete` | wizard complete sentinel |
| `~/.bloom/setup-state.json` | Pi-side setup state |
| `~/.bloom/wizard-state/persona-done` | persona step complete marker |

## Tools

`bloom-setup` provides:

- `setup_status`
- `setup_advance`
- `setup_reset`

Current behavior:

- before the wizard completes, `setup_status` reports that Pi is waiting for the wizard
- after the wizard completes, Pi injects persona-step guidance until the `persona` step is marked complete

## Recovery

If setup state is corrupt:

- `bloom-setup` backs up a corrupt `setup-state.json`
- a fresh initial state is created automatically

If you want to restart only the Pi-side step:

- use `setup_reset(step="persona")`

If you want to restart all Pi-side setup state:

- use `setup_reset()` with no step

## After Setup

Typical next actions:

- inspect host status with `system_health`
- inspect service state with `manifest_show`
- install or apply services with `service_install` or `manifest_apply`
- create additional Matrix agents with `agent_create`

## Related

- [docs/quick_deploy.md](quick_deploy.md)
- [docs/live-testing-checklist.md](live-testing-checklist.md)
- [AGENTS.md](../AGENTS.md)
