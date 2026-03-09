# piBloom First-Boot Setup

> 📖 [Emoji Legend](LEGEND.md)

This guide is for the first interactive session on a freshly installed Bloom OS machine.

> Important: commands like `service_install`, `manifest_apply`, `bloom_repo` are **Pi tools**.
> They are not shell binaries unless explicitly wrapped by your environment.

```mermaid
flowchart TD
    Start([🚀 First Boot]) --> LLM[1. 🤖 Configure LLM provider]
    LLM --> Auth[2. 🛡️ GitHub auth]
    Auth --> Repo[3. 🤖 Configure device repo]
    Repo --> Services[4. 📦 Install services via manifest]
    Services --> Follow[5. 📦 Service-specific setup]
    Follow --> Mark[6. 🚀 Mark setup complete]
    Mark --> Health[7. 💻 Health check]
    Health --> Done([✅ Ready])
```

## 0) 💻 Prerequisite

If `~/.bloom/.setup-complete` exists, first-boot was already completed.

Fresh Bloom OS images grant user `bloom` passwordless `sudo` for bootstrap operations.

## 1) 🤖 LLM provider and API key

Configure your preferred provider in Pi (OpenAI, Anthropic, etc.) and validate with a short prompt.

## 2) 🛡️ GitHub auth (for PR-based self-evolution)

```bash
gh auth login
gh auth status
```

## 3) 🤖 Configure device repo for PR flow

Use Pi tools (recommended):

1. `bloom_repo(action="configure", repo_url="https://github.com/pibloom/pi-bloom.git")`
2. `bloom_repo(action="status")`
3. `bloom_repo(action="sync", branch="main")`

Expected local path:

- `~/.bloom/pi-bloom`

## 4) 📦 Configure optional service modules (manifest-first)

Declare desired services in `~/Bloom/manifest.yaml` via tool calls:

- `manifest_set_service(name="dufs", image="docker.io/sigoden/dufs:latest", version="0.1.0", enabled=true)`
- `manifest_set_service(name="lemonade", image="ghcr.io/lemonade-sdk/lemonade-server:v9.4.1", version="0.1.0", enabled=true)`

Preview:

- `manifest_apply(dry_run=true)`

Apply:

- `manifest_apply(install_missing=true)`

## 5) 📦 Service-specific follow-up

### 📦 NetBird

NetBird is installed as a system RPM service on the OS image.

Authenticate:

```bash
sudo netbird up
```

Check status:

```bash
sudo netbird status
```

Logs:

```bash
sudo journalctl -u netbird -f
```

### 📦 Matrix + Element

Matrix messaging uses a self-hosted Continuwuity homeserver (bloom-matrix) and Element bot bridge (bloom-element).

Install via manifest or directly:

- `manifest_set_service(name="matrix", image="forgejo.ellis.link/continuwuation/continuwuity:latest", version="0.1.0", enabled=true)`
- `manifest_set_service(name="element", image="localhost/bloom-element:latest", version="0.1.0", enabled=true)`
- Or: `service_install(name="matrix")` then `service_install(name="element")`

Get connection details:

- `service_pair(name="element")`

## 6) 🚀 Mark setup complete

```bash
touch ~/.bloom/.setup-complete
```

## 7) 💻 Health check

Run:

- `system_health`
- `manifest_show`
- `manifest_sync(mode="detect")`

## 🔗 Related

- [Emoji Legend](LEGEND.md) — Notation reference
- [Quick Deploy](quick_deploy.md) — OS build and deployment
- [Fleet Bootstrap Checklist](fleet-bootstrap-checklist.md) — PR-ready device setup
- [AGENTS.md](../AGENTS.md) — Extension, tool, and hook reference
