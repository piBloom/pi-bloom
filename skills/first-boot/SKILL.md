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
- Clarify tool-vs-shell: `service_install`, `bloom_repo_configure`, etc. are Pi tools (not bash commands)

## Setup Steps

### 1) LLM Provider + API Key

- Ask preferred provider (Anthropic, OpenAI, etc.)
- Help configure API key in Pi settings

### 2) GitHub Authentication

```bash
gh auth login
gh auth status
```

### 3) Device Git Identity

Prefer repo-local identity via tool setup (instead of global):

- `bloom_repo_configure(git_name="Bloom (<hostname>)", git_email="bloom+<hostname>@localhost")`

Ask if user wants custom values.

### 4) Configure Bloom Source Repo for PR Flow

Use `bloom_repo_configure` to make the repo ready for contribution:

- set `upstream` to canonical source repo
- set `origin` to writable fork
- clone into `~/.bloom/pi-bloom` if missing

Preferred sequence:
1. `bloom_repo_configure(repo_url="https://github.com/{owner}/pi-bloom.git")`
2. `bloom_repo_status` (verify PR-ready state)
3. `bloom_repo_sync(branch="main")`

If fork URL is already known, pass `fork_url` explicitly.
If not, `bloom_repo_configure` tries to create/attach one via `gh` when authenticated.

### 5) Syncthing Setup (tool-first)

- Install service package: `service_install(name="syncthing", version="0.1.0")`
- Validate service: `service_test(name="syncthing")`
- Direct user to `http://localhost:8384`
- Help add/share `~/Garden` (mapped in container as `/var/syncthing/Garden`)

If Bloom runs inside a VM, `localhost` in the guest may not be reachable from the host machine.
Offer one of these access paths:

- QEMU host-forwarded port (recommended in dev): host `localhost:8384` → guest `8384`
- SSH tunnel: `ssh -L 8384:localhost:8384 -p 2222 bloom@localhost`
- Guest IP direct access on LAN if routing allows (`http://<guest-ip>:8384`)

### 6) Optional Service Packages (manifest-first)

Prefer declarative setup:

1. Declare desired services in manifest (`manifest_set_service`)
2. Apply desired state (`manifest_apply(install_missing=true)`)
3. Validate selected services (`service_test` / `systemd_control` / `container_logs`)

Suggested optional profiles:

- **sync-only**: syncthing
- **communication**: whatsapp + whisper
- **remote-access**: tailscale (+ syncthing recommended)

Example declaration flow:

1. `manifest_set_service(name="syncthing", image="docker.io/syncthing/syncthing@sha256:...", version="0.1.0", enabled=true)`
2. `manifest_set_service(name="whatsapp", image="ghcr.io/alexradunet/bloom-whatsapp:latest", version="0.1.0", enabled=true)`
3. `manifest_set_service(name="whisper", image="docker.io/fedirz/faster-whisper-server@sha256:...", version="0.1.0", enabled=true)`
4. `manifest_set_service(name="tailscale", image="docker.io/tailscale/tailscale@sha256:...", version="0.1.0", enabled=true)`
5. `manifest_apply(install_missing=true)`

Post-install guidance:

- WhatsApp pairing: `journalctl --user -u bloom-whatsapp -f` and scan QR
- Tailscale preflight: confirm `bloom` has entries in `/etc/subuid` and `/etc/subgid`
- Tailscale auth: `podman exec bloom-tailscale tailscale up`

If tooling is unavailable, use the fallback manual `oras pull` flow from `skills/service-management/SKILL.md`.

### 7) Mark Setup Complete

```bash
touch ~/.bloom/.setup-complete
```

## Notes

- Revisit skipped steps on demand
- Confirm each critical step before moving on
