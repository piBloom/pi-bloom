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
- Clarify tool-vs-shell: `service_install`, `bloom_repo`, etc. are Pi tools (not bash commands)
- On fresh Bloom OS, user `bloom` has passwordless `sudo` for bootstrap tasks.

## Pre-Requisite: NetBird

NetBird mesh networking is configured before Pi starts (during the login greeting). If the user skipped it, they can authenticate later:

```bash
sudo netbird up
```

Verify with `sudo netbird status` -- look for "Connected".

## Setup Steps

### 1) Git Identity

Ask the user for their name and email, then set globally:

```bash
git config --global user.name "<name>"
git config --global user.email "<email>"
```

Suggest sensible defaults (e.g., hostname-based) but let the user choose.

### 2) dufs Setup

- Install service package: `service_install(name="dufs", version="0.1.0")`
- Validate service: `service_test(name="dufs")`
- The WebDAV password is the channel token in `~/.config/bloom/channel-tokens/dufs.env` (BLOOM_CHANNEL_TOKEN)
- Direct user to `http://localhost:5000` (username: `admin`)
- dufs serves `$HOME` over WebDAV (mapped in container as bind mount)

If Bloom runs inside a VM, `localhost` in the guest may not be reachable from the host machine.
Offer one of these access paths:

- QEMU host-forwarded port (recommended in dev): host `localhost:5000` -> guest `5000`
- SSH tunnel: `ssh -L 5000:localhost:5000 -p 2222 bloom@localhost`
- Guest IP direct access on LAN if routing allows (`http://<guest-ip>:5000`)

### 3) Optional Services

#### Lemonade (local LLM + speech-to-text)

- Install service package: `service_install(name="lemonade", version="0.1.0")`
- Validate: `service_test(name="lemonade")`
- API available at `http://localhost:8000` (OpenAI-compatible)

#### WhatsApp Bridge

- Install service package: `service_install(name="whatsapp")`
- Watch logs for QR code: `journalctl --user -u bloom-whatsapp -f`
- Scan QR with WhatsApp mobile app (Settings > Linked Devices)
- Verify: `service_test(name="whatsapp")`

The WhatsApp bridge needs the bloom-channels socket for IPC. If bloom-channels is not running, WhatsApp will reconnect automatically when it becomes available.

### 4) Mark Setup Complete

```bash
touch ~/.bloom/.setup-complete
```

## Notes

- Revisit skipped steps on demand
- Confirm each critical step before moving on

## Developer Mode (optional, not part of first-boot)

For contributors who want to submit PRs back to the Bloom repo, install `gh` and configure the repo:

```bash
sudo dnf install gh
gh auth login
```

Then use `bloom_repo` to set up fork-based PR flow:
1. `bloom_repo(action="configure", repo_url="https://github.com/{owner}/pi-bloom.git")`
2. `bloom_repo(action="status")` (verify PR-ready state)
3. `bloom_repo(action="sync", branch="main")`
