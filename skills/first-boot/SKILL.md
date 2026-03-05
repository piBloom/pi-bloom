---
name: first-boot
description: Guide the user through one-time Bloom system setup on a fresh install
---

# First-Boot Setup

Use this skill on the first session after a fresh Bloom OS install.

## Prerequisite Check

If `~/.bloom/.setup-complete` exists, setup is already complete. Skip unless user asks to re-run specific steps.

## Setup Style

- Be conversational (one step at a time)
- Let user skip/defer steps
- Prefer Bloom tools over long shell copy-paste blocks

## Setup Steps

### 1) LLM Provider + API Key

- Ask preferred provider (Anthropic, OpenAI, etc.)
- Help configure API key in Pi settings

### 2) GitHub Authentication

```bash
gh auth login
gh auth status
```

### 3) Git Identity

```bash
git config --global user.name "Bloom"
git config --global user.email "bloom@localhost"
```

Ask if user wants custom values.

### 4) Clone Bloom Source Repo (self-evolution)

```bash
mkdir -p ~/.bloom
```

Prefer auto-detection:
- Get image reference from `bootc status --format=json`
- Infer GitHub owner from image (`ghcr.io/{owner}/bloom-os`)
- Clone `https://github.com/{owner}/pibloom.git` into `~/.bloom/pibloom`

Fallback: ask user for the repo URL.

### 5) Syncthing Setup

- Check service state (user/system depending on host setup)
- Direct user to `http://localhost:8384`
- Help add/share `~/Garden`

### 6) Optional Service Packages (tool-first)

Prefer Bloom tools:

- Install: `service_install`
- Validate: `service_test`
- Check status/logs: `systemd_control` + `container_logs`
- Confirm manifest: `manifest_show`

Recommended order:

1. `service_install(name="whatsapp", version="0.1.0")`
2. `service_install(name="whisper", version="0.1.0")` (optional but recommended with WhatsApp)
3. `service_install(name="tailscale", version="0.1.0")` (optional)

Post-install guidance:

- WhatsApp pairing: `journalctl --user -u bloom-whatsapp -f` and scan QR
- Tailscale auth: `podman exec bloom-tailscale tailscale up`

If tooling is unavailable, use the fallback manual `oras pull` flow from `skills/service-management/SKILL.md`.

### 7) Mark Setup Complete

```bash
touch ~/.bloom/.setup-complete
```

## Notes

- Revisit skipped steps on demand
- Confirm each critical step before moving on
