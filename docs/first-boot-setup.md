# nixPI First-Boot Setup

> 📖 [Emoji Legend](LEGEND.md)

Audience: operators bringing up a fresh nixPI host.

## Prerequisites

Before first-boot setup, you need a NixOS system with nixPI applied:

1. Install NixOS using the [official ISO](https://nixos.org/download.html)
2. After first boot, apply the nixPI configuration:
   ```bash
   sudo nixos-rebuild switch --flake github:alexradunet/piBloom#desktop
   ```
3. Reboot or log out/in, then the first-boot wizard will start automatically

> 🛡️ **Security Note: NetBird is Mandatory**
>
> NetBird is the network security boundary for all nixPI services. The firewall
> configuration (`trustedInterfaces = ["wt0"]`) only protects services when the
> NetBird interface (`wt0`) is active. Without NetBird:
> - Matrix, Home (port 8080), dufs (port 5000), and code-server (port 8443)
>   are exposed to the local network
> - A compromised local device could access OS tools via prompt injection
>
> **Complete NetBird setup and verify `wt0` is active before exposing this
> machine to any network.**

## 🌱 Why Setup Is Split In Two

nixPI separates deterministic machine setup from Pi-guided personalization.

That split keeps:

- host provisioning in a predictable bash flow
- persona customization in Pi where it belongs
- interrupted setup resumable without redoing the entire host bootstrap

## 💻 How First Boot Works

nixPI's first-boot experience has two phases.

### Phase 1: Bash Wizard

`setup-wizard.sh` handles deterministic machine setup on first interactive login.

Current responsibilities:

1. password change and connectivity checks
2. NetBird enrollment
3. primary Matrix account bootstrap
4. AI provider defaults for Pi
5. built-in service provisioning
6. optional switch to registry image for OTA updates

Built-in services provisioned by the wizard:

- Home landing page on port `8080`
- Web Chat (`fluffychat`) on port `8081`
- `dufs` WebDAV file server on port `5000`
- `code-server` on port `8443`

### Phase 2: Pi Persona Step

After the wizard is complete, `setup` tracks a single Pi-side step:

- `persona`

Pi injects setup guidance until that step is marked complete.

During that Pi-side first conversation, Pi should also orient the user to the platform:

- nixPI keeps durable state in `~/Workspace/` using inspectable files
- nixPI can propose persona or workflow changes through tracked evolutions instead of silently changing itself
- Matrix is the native messaging surface, with `pi-daemon.service` keeping Pi active in rooms outside the local terminal session
- multi-agent rooms are optional and activate when valid overlays exist in `~/Workspace/Agents/*/AGENTS.md`

### Recovery

If setup state is corrupt:

- `setup` backs up a corrupt `setup-state.json`
- a fresh initial state is created automatically

If you want to restart only the Pi-side step:

- use `setup_reset(step="persona")`

If you want to restart all Pi-side setup state:

- use `setup_reset()` with no step

## 📚 Reference

Relevant files:

| Path | Purpose |
|------|---------|
| `~/.workspace/.setup-complete` | wizard complete sentinel |
| `~/.workspace/setup-state.json` | Pi-side setup state |
| `~/.workspace/wizard-state/persona-done` | persona step complete marker |
| `~/.pi/matrix-credentials.json` | primary Matrix credentials |

Current tool surface:

- `setup_status`
- `setup_advance`
- `setup_reset`

Current behavior:

- before the wizard completes, `setup_status` reports that Pi is waiting for the wizard
- after the wizard completes, opening Pi causes it to check `setup_status()` before normal conversation
- if any Pi-side setup step is still pending, Pi starts that setup flow first and defers unrelated conversation until the step is completed or skipped
- after all Pi-side setup steps are done, Pi resumes normal conversation and the `persona` step remains marked complete
- the wizard enables `pi-daemon.service` as part of setup completion, and later sessions re-enable it if needed
- the wizard refreshes the built-in service configs so NetBird peers have a stable page listing service URLs and shareable host info

## 🔗 Related

- [quick_deploy.md](quick_deploy.md)
- [live-testing-checklist.md](live-testing-checklist.md)
- [../AGENTS.md](../AGENTS.md)
