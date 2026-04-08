# Runtime Flows

> How the terminal-first NixPI runtime boots, routes traffic, and enters Pi

## Audience

Operators and maintainers debugging the active NixPI runtime path.

## Current Runtime Shape

NixPI no longer uses a browser chat server as the primary product surface.

The active runtime path is:

1. `nixpi-app-setup.service` prepares `~/.pi`
2. `nixpi-ttyd.service` starts ttyd on `127.0.0.1:7681`
3. `nginx` proxies `/` and `/terminal/` to ttyd
4. ttyd launches `core/scripts/nixpi-terminal-bootstrap.sh`
5. the bootstrap wrapper enters `pi`

## Boot and Service Startup Flow

```text
systemd boot
    ↓
multi-user.target
    ↓
├─ wireguard-wg0.service
├─ nixpi-app-setup.service
├─ nixpi-ttyd.service
├─ nixpi-update.service
└─ nginx.service
```

### Key Files

| File | Role |
|------|------|
| `core/os/modules/app.nix` | Pi runtime install and state-directory setup |
| `core/os/modules/ttyd.nix` | ttyd service definition and environment wiring |
| `core/os/modules/service-surface.nix` | nginx routing and TLS setup |
| `core/scripts/nixpi-terminal-bootstrap.sh` | terminal bootstrap wrapper that enters Pi |

## Browser Entry Flow

```text
Browser
  ↓
nginx (/ or /terminal/)
  ↓
ttyd
  ↓
nixpi-terminal-bootstrap
  ↓
pi
```

### Important Runtime Properties

- `/` is the canonical browser entrypoint
- `/terminal/` is an alias to the same ttyd-backed terminal surface
- ttyd is transport, not product logic
- Pi owns the actual user experience

## Setup-vs-Normal Flow

Pi behavior changes based on:

- `~/.nixpi/wizard-state/system-ready` missing → setup mode
- `~/.nixpi/wizard-state/system-ready` present → normal mode

In setup mode, Pi should:

1. guide `/login`
2. guide `/model`
3. walk through git identity setup, WireGuard, security configuration, and intro/tutorial
4. write `system-ready` only when onboarding is complete

## Transport Parity

The same Pi workflow should be available from:

- ttyd in the browser
- SSH
- local terminal / tty login

The browser path should not have its own separate setup semantics.

## Troubleshooting

Useful checks:

```bash
systemctl status nixpi-app-setup.service
systemctl status nixpi-ttyd.service
systemctl status nginx.service
journalctl -u nixpi-ttyd.service -n 100
curl -I http://127.0.0.1/
curl -I http://127.0.0.1/terminal/
```

If the browser path fails, verify `pi` still works directly over SSH or a local shell. That distinguishes transport problems from Pi/runtime problems.

## Related

- [Service Architecture](../reference/service-architecture)
- [Daemon Architecture](../reference/daemon-architecture)
- [First Boot Setup](../operations/first-boot-setup)
