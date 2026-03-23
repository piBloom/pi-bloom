# First Boot Setup

> Bringing up a fresh NixPI host

## Audience

Operators bringing up a fresh NixPI host.

## Prerequisites

Before first-boot setup, you need a system installed from the NixPI installer image:

1. Build or download the NixPI installer ISO
2. Boot the installer and run `sudo -i && nixpi-installer`
3. Choose your target disk and layout, then enter your hostname and primary user in the terminal wizard
4. Reboot into the installed system
5. The installed machine initially boots a minimal NixPI base from `/etc/nixos`
6. During first boot, the setup wizard creates the local `~/nixpi` checkout and the host-specific flake at `/etc/nixos`
7. The installed system autologins into the official NixPI Openbox desktop and opens the NixPI terminal there

For VM install-flow testing:

- `just vm-install-iso` runs the installer in the default user-mode NAT network with SSH forwarding
- use this path to validate install flow, Openbox startup, and in-guest NetBird enrollment
- use the printed localhost forwards for host-side access to SSH, Home, Element Web, and Matrix
- do not expect the guest NetBird mesh IP to behave like a real inbound-reachable peer from the host or LAN in this VM mode

## Security Note: NetBird Is Mandatory

NetBird is the network security boundary for all NixPI services. The firewall configuration (`trustedInterfaces = ["wt0"]`) only protects services when the NetBird interface (`wt0`) is active. Without NetBird:

- Matrix, Home (ports 80 and 8080), and Element Web (port 8081) are exposed to the local network
- A compromised local device could access OS tools via prompt injection

**Complete NetBird setup and verify `wt0` is active before exposing this machine to any network.**

## Why Setup Is Split In Two

NixPI separates deterministic machine setup from Pi-guided personalization.

That split keeps:

- Host provisioning in a predictable bash flow
- Persona customization in Pi where it belongs
- Interrupted setup resumable without redoing the entire host bootstrap

## How First Boot Works

NixPI's first-boot experience has two phases.

### Phase 1: Bash Wizard

`setup-wizard.sh` handles deterministic machine setup from the Openbox-launched NixPI terminal.

**Current responsibilities**:

1. Password change and WiFi/internet setup
2. Clone `~/nixpi` and write the host-specific `/etc/nixos` flake
3. Promote the minimal base into the full appliance with `nixos-rebuild switch`
4. NetBird enrollment
   OAuth web login works from the desktop flow. Use a setup key only if a browser session is unavailable.
5. Primary Matrix account bootstrap
6. AI provider defaults for Pi
7. Built-in service provisioning
8. User-facing system update guidance for operating the local `~/nixpi` checkout

**Built-in services provisioned**:

- Home status page on port `8080`
- Home front door on port `80`
- Element Web on port `8081`

**Bootstrap security lifecycle**:

- SSH on port `22` is available during bootstrap
- The installed desktop profile keeps SSH available after setup so the machine remains reachable for remote administration and VM debugging
- Matrix registration is available during bootstrap and disabled by default after setup completes
- Lower-level test and custom module compositions can still set `nixpi.bootstrap.keepSshAfterSetup = false` if they need bootstrap-only SSH

### Phase 2: Pi Persona Step

After the wizard is complete, `setup` tracks a single Pi-side step:

- `persona`

Pi injects setup guidance until that step is marked complete.

During that Pi-side first conversation, Pi should also orient the user to the platform:

- NixPI keeps durable state in `~/nixpi/` using inspectable files
- `~/nixpi` is the canonical git working tree for syncing with a fork and pulling from upstream, while `/etc/nixos` is the deployed host flake used for rebuilds
- NixPI can propose persona or workflow changes through tracked evolutions instead of silently changing itself
- Matrix is the native messaging surface, with `nixpi-daemon.service` keeping Pi active in rooms outside the local terminal session as a system service running under the primary operator account
- Multi-agent rooms are optional and activate when valid overlays exist in `~/nixpi/Agents/*/AGENTS.md`

## Recovery

If you want to redo persona setup, remove `~/.nixpi/wizard-state/persona-done` and open Pi again.

## Reference

### Relevant Files

| Path | Purpose |
|------|---------|
| `~/.nixpi/.setup-complete` | Wizard complete sentinel |
| `~/.nixpi/wizard-state/persona-done` | Persona step complete marker |
| `~/.pi/matrix-credentials.json` | Primary Matrix credentials |

### Current Behavior

- Before the wizard completes, Pi does not start normal conversation
- After the wizard completes, opening Pi checks only for `persona-done`
- If persona setup is still pending, Pi starts that flow first and defers unrelated conversation
- After `persona-done` exists, Pi resumes normal conversation
- Openbox is the only supported automatic first-boot entry path
- The wizard enables `nixpi-daemon.service` as part of setup completion
- The wizard refreshes Matrix policy so public registration is no longer left open after setup
- The wizard refreshes the built-in service configs so NetBird peers have a stable page listing service URLs and shareable host info

## Related

- [Quick Deploy](./quick-deploy)
- [Live Testing](./live-testing)
