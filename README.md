# Bloom

> 📖 [Emoji Legend](docs/LEGEND.md)

Bloom is a Pi package and bootc-based OS image for running Pi as a personal, self-hosted companion on a Fedora host.
This repository contains:

- the Bloom core: OS image assets, Pi runtime integration, persona, skills, and built-in extensions
- optional extensions and bundled service packages
- the Matrix room daemon: a long-running service that bridges Matrix rooms to Pi SDK-backed sessions

## What Ships Today

Bloom currently provides:

- Bloom directory management and blueprint seeding for `~/Bloom/`
- persona injection, shell guardrails, and compaction context persistence
- an audit trail for tool calls and tool results
- OS management tools for `bootc`, containers, systemd, health, and scheduled reboot
- repository bootstrap, sync, and PR submission helpers
- service scaffolding, installation, smoke testing, manifest management, and bridge lifecycle tools
- a flat-file object store in `~/Bloom/Objects/`
- an optional multi-agent Matrix daemon with one Pi session per `(room, agent)` pair
- a first-boot flow split between a bash wizard and a Pi-guided persona step

## Default Install

The default OS image is intentionally small. On a fresh box, Bloom installs:

- `sshd.service`
- `netbird.service`
- `bloom-matrix.service`
- `pi-daemon.service` after setup when AI credentials/defaults are ready

Optional packaged services are not installed automatically. Today that includes:

- `cinny`
- `dufs`
- `code-server`
- Matrix bridges

Not installed by default:

- `caddy`
- `cinny`
- any bundled web reverse proxy

Operational hardening in the current tree:

- invalid `~/Bloom/Agents/*/AGENTS.md` files are skipped with warnings instead of crashing the daemon
- daemon duplicate/cooldown/reply-budget state is bounded so long-running processes do not grow unbounded maps forever
- corrupt `~/Bloom/manifest.yaml` files are quarantined to `manifest.yaml.corrupt-*` before Bloom falls back to an empty manifest
- `manifest_apply` now attempts persistent `systemctl --user enable --now` / `disable --now`, with start/stop fallback when enablement is not supported
- local `localhost/*` service images are rebuilt on install so mutable tags do not silently reuse stale code

## Repository Layout

| Path | Purpose |
|------|---------|
| `core/` | Bloom core: OS image, daemon, persona, skills, built-in extensions, and shared runtime code |
| `extensions/` | non-core Pi extensions such as dev and repo tooling |
| `services/` | bundled service packages and service template |
| `tests/` | unit, integration, daemon, and extension tests |
| `docs/` | live project documentation |

## Core And Extensions

Core extensions live under `core/extensions/`. Optional/operator extensions stay under `extensions/`.

| Extension | Tools | Hooks / Commands |
|-----------|-------|------------------|
| `bloom-persona` | — | `session_start`, `before_agent_start`, `tool_call`, `session_before_compact` |
| `bloom-audit` | `audit_review` | `session_start`, `tool_call`, `tool_result` |
| `bloom-os` | `bootc`, `container`, `systemd_control`, `system_health`, `update_status`, `schedule_reboot` | `before_agent_start` |
| `bloom-repo` | `bloom_repo`, `bloom_repo_submit_pr` | — |
| `bloom-services` | `service_scaffold`, `service_install`, `service_test`, `manifest_show`, `manifest_sync`, `manifest_set_service`, `manifest_apply`, `bridge_create`, `bridge_remove`, `bridge_status` | `session_start` |
| `bloom-objects` | `memory_create`, `memory_read`, `memory_search`, `memory_link`, `memory_list` | — |
| `bloom-garden` | `garden_status`, `skill_create`, `skill_list`, `agent_create`, `persona_evolve` | `session_start`, `resources_discover`, `/bloom` |
| `bloom-dev` | `dev_enable`, `dev_disable`, `dev_status`, `dev_code_server`, `dev_build`, `dev_switch`, `dev_rollback`, `dev_loop`, `dev_test`, `dev_submit_pr`, `dev_push_skill`, `dev_push_service`, `dev_push_extension`, `dev_install_package` | — |
| `bloom-setup` | `setup_status`, `setup_advance`, `setup_reset` | `before_agent_start` |

## Bundled Skills

Bundled skill directories in `core/skills/`:

- `first-boot`
- `object-store`
- `os-operations`
- `recovery`
- `self-evolution`
- `service-management`

## Bundled Service Packages

| Package | Current role |
|---------|--------------|
| `dufs` | packaged Quadlet service exposed on port `5000` |
| `code-server` | packaged service built locally as `localhost/bloom-code-server:latest` |
| `_template` | scaffold template for new services |

Reference material for OS-level infrastructure also lives under `services/`:

- `services/matrix/SKILL.md`
- `services/netbird/SKILL.md`

## Daemon Model

`core/daemon/index.ts` starts the Bloom room daemon in one of two modes:

- single-agent fallback when no valid agent definitions exist in `~/Bloom/Agents/*/AGENTS.md`
- multi-agent mode when one or more agent overlays parse successfully, with one Matrix client per configured agent and
  one Pi session per `(room, agent)` pair
- malformed agent overlays are logged and skipped instead of aborting daemon startup

Each room session is backed by Pi's in-process SDK session lifecycle.

## Build and Test

```bash
npm install
npm run build
npm run check
npm run test
```

`npm run check` uses the locally installed `biome` binary from project dependencies; it no longer shells out through
`npx`.

Additional commands:

```bash
npm run test:coverage
just build
just qcow2
just iso
just vm
just vm-ssh
```

## Key Docs

- [AGENTS.md](AGENTS.md) for the complete tool, hook, path, and feature reference
- [ARCHITECTURE.md](ARCHITECTURE.md) for the current structure and design rules
- [docs/service-architecture.md](docs/service-architecture.md) for the Skill / Extension / Service model
- [docs/pibloom-setup.md](docs/pibloom-setup.md) for first boot
- [docs/quick_deploy.md](docs/quick_deploy.md) for image build and install
- [docs/fleet-pr-workflow.md](docs/fleet-pr-workflow.md) for repo contribution flow
- [docs/supply-chain.md](docs/supply-chain.md) for image and package trust rules
