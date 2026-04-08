---
name: first-boot
description: Pi-guided first boot and onboarding for a terminal-first NixPI machine
---

# First-Boot: Terminal-First Onboarding

## Prerequisite

This skill applies while `~/.nixpi/wizard-state/system-ready` does **not** exist.

The browser surface is ttyd, not a separate chat app. The same setup should also work from SSH or a local terminal.

## How This Works

1. If Pi is not authenticated yet, guide the user through `/login`
2. If a model is not selected yet, guide the user through `/model`
3. Once Pi is ready, keep the user in setup mode until onboarding is complete
4. Guide the user through:
   - git identity setup for `/srv/nixpi`
   - WireGuard configuration
   - OS security configuration
   - a short NixPI intro/tutorial
5. Only when the full flow is complete should Pi write `~/.nixpi/wizard-state/system-ready`

## Conversation Style

- **Pi leads the setup** — this is a Pi-native onboarding flow
- **One step at a time** — never dump the whole checklist at once
- **Terminal first** — all instructions should make sense in ttyd, SSH, or a local shell
- **Verification over assumption** — check commands and system state before advancing
- **Setup takes priority** until the completion marker exists
