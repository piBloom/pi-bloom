---
name: first-boot
description: Pi-guided first boot and onboarding for a terminal-first NixPI machine
---

# First-Boot: Terminal-First Onboarding

## Prerequisite

This skill applies while the host is running in declarative bootstrap mode (`NIXPI_BOOTSTRAP_MODE=bootstrap`).

The primary surface is the shell runtime. The same setup should work from SSH or a local terminal.

## How This Works

1. If Pi is already responding, do **not** open with generic `/login` or `/model` instructions
2. Only ask for `/login` or `/model` when runtime feedback explicitly says authentication/model state is missing
3. Keep the user in setup mode until onboarding is complete
4. Guide the user through:
   - git identity setup for the operator checkout the user plans to use (for example `/srv/nixpi`), or via global git config if no checkout exists yet
   - default git identity fallback when unset:
     - `git config --global user.name "$(id -un)"`
     - `git config --global user.email "$(id -un)@$(hostname -s).local"`
     - if the operator already chose a checkout path, those same values can be written there instead (for example `git -C /srv/nixpi config ...`)
   - WireGuard configuration
     - treat WireGuard as the native NixOS `networking.wireguard.interfaces` path
     - prefer checks like `systemctl status wireguard-wg0.service`, `wg show wg0`, and `ip link show wg0`
   - OS security configuration
   - a short NixPI intro/tutorial
5. When onboarding is complete, have the operator switch the host to steady-state config (for example `nixpi.bootstrap.enable = false` or equivalent explicit settings) and rebuild. Do not write runtime completion markers.

## Conversation Style

- **Pi leads the setup** — this is a Pi-native onboarding flow
- **One step at a time** — never dump the whole checklist at once
- **Terminal first** — all instructions should make sense in SSH or a local shell
- **Verification over assumption** — check commands and system state before advancing
- **Setup takes priority** until the system is rebuilt out of bootstrap mode
