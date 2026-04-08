# Infrastructure

> Runtime services and access infrastructure

## Operator-Facing Runtime

NixPI exposes a shell-first Pi runtime rather than a browser-hosted terminal surface.

### Configuration

| Setting | Value |
|---------|-------|
| Runtime setup unit | `nixpi-app-setup.service` |
| Remote shell access | `sshd.service` |
| Preferred private management network | `wireguard-wg0.service` |
| Running host source of truth | installed `/etc/nixos` flake |
| Standard rebuild command | `sudo nixpi-rebuild` |
| Optional `/srv/nixpi` sync helper | `sudo nixpi-rebuild-pull [branch]` |

`/srv/nixpi` is a conventional operator checkout path, not a convergence requirement for a healthy installed host.

### Intentional imperative helpers

The remaining imperative commands are operator-initiated wrappers, not boot-time convergence requirements.

| Command | Why it remains imperative |
|---------|---------------------------|
| `nix run .#nixpi-deploy-ovh -- ...` | Fresh provisioning still needs runtime inputs such as the rescue host, target disk, and optional bootstrap credentials. NixPI keeps that imperative surface at install time instead of trying to model rescue-mode disk selection as steady-state host config. |
| `sudo nixpi-rebuild-pull [branch]` | Syncing a conventional `/srv/nixpi` checkout to an operator-chosen remote branch is an explicit human workflow. The declarative host state stays in `/etc/nixos`; the helper only updates an optional operator workspace before rebuilding. |

### Troubleshooting

```bash
systemctl status nixpi-app-setup.service
systemctl status sshd.service
systemctl status wireguard-wg0.service
systemctl status nixpi-update.timer
wg show wg0
```
