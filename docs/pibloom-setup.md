# Bloom First-Boot Setup

> 📖 [Emoji Legend](LEGEND.md)

Audience: operators bringing up a fresh Bloom host.

## 🌱 Why Setup Is Split In Two

Bloom separates deterministic machine setup from Pi-guided personalization.

That split keeps:

- host provisioning in a predictable bash flow
- persona customization in Pi where it belongs
- interrupted setup resumable without redoing the entire host bootstrap

## 💻 How First Boot Works

Bloom's first-boot experience has two phases.

### Phase 1: Bash Wizard

`bloom-wizard.sh` handles deterministic machine setup on first interactive login.

Current responsibilities:

1. password change and connectivity checks
2. NetBird enrollment
3. primary Matrix account bootstrap
4. AI provider defaults for Pi
5. optional bundled service choices

Optional service prompts offered by the wizard:

- Bloom Home landing page on port `8080` (built into the image)
- Bloom Web Chat (`cinny`) on port `8081`
- `dufs` WebDAV file server on port `5000`

What the wizard does not install by default:

- `code-server`
- Matrix bridges

### Phase 2: Pi Persona Step

After the wizard is complete, `bloom-setup` tracks a single Pi-side step:

- `persona`

Pi injects setup guidance until that step is marked complete.

### Recovery

If setup state is corrupt:

- `bloom-setup` backs up a corrupt `setup-state.json`
- a fresh initial state is created automatically

If you want to restart only the Pi-side step:

- use `setup_reset(step="persona")`

If you want to restart all Pi-side setup state:

- use `setup_reset()` with no step

## 📚 Reference

Relevant files:

| Path | Purpose |
|------|---------|
| `~/.bloom/.setup-complete` | wizard complete sentinel |
| `~/.bloom/setup-state.json` | Pi-side setup state |
| `~/.bloom/wizard-state/persona-done` | persona step complete marker |
| `~/.pi/matrix-credentials.json` | primary Matrix credentials |

Current tool surface:

- `setup_status`
- `setup_advance`
- `setup_reset`

Current behavior:

- before the wizard completes, `setup_status` reports that Pi is waiting for the wizard
- after the wizard completes, Pi injects persona-step guidance until the `persona` step is marked complete
- the wizard enables `pi-daemon.service` only when both Pi auth and default model settings are present
- the wizard provisions built-in Bloom Home so NetBird peers have a stable page listing installed services, URLs, and shareable host info

## 🔗 Related

- [quick_deploy.md](quick_deploy.md)
- [live-testing-checklist.md](live-testing-checklist.md)
- [../AGENTS.md](../AGENTS.md)
