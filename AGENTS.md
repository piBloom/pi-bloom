# AGENTS.md

> 📖 [Emoji Legend](docs/LEGEND.md)

Bloom is a Pi package plus OS image that teaches Pi about its host, its services, and its own operating model.

## Current Model

Bloom extends Pi through three mechanisms:

| Layer | What | Current use |
|------|------|-------------|
| Skill | bundled or user-created `SKILL.md` files | guidance, procedures, service docs |
| Extension | in-process TypeScript | tools, hooks, commands, stateful host integration |
| Service | packaged container workloads | optional long-running user services |

OS-level infrastructure is separate from service packages and is baked into the image:

- `bloom-matrix.service`
- `netbird.service`
- `pi-daemon.service`

Repository structure note:

- `core/` is Bloom itself: OS image assets, daemon, persona, bundled skills, built-in extensions, and shared runtime code
- `extensions/` is reserved for non-core/operator extensions such as dev and repo tooling

## Bloom Directory

Default Bloom home is `~/Bloom/` unless `BLOOM_DIR` is set.

| Path | Purpose |
|------|---------|
| `~/Bloom/Persona/` | active persona files |
| `~/Bloom/Skills/` | installed and seeded skills |
| `~/Bloom/Evolutions/` | proposed persona / system evolutions |
| `~/Bloom/Objects/` | flat-file object store |
| `~/Bloom/Agents/` | multi-agent overlays (`AGENTS.md`) |
| `~/Bloom/audit/` | audit JSONL files |
| `~/Bloom/manifest.yaml` | declarative service manifest |
| `~/Bloom/guardrails.yaml` | command-block policy override |
| `~/Bloom/blueprint-versions.json` | blueprint seeding state |

Related state outside `~/Bloom/`:

| Path | Purpose |
|------|---------|
| `~/.pi/` | Pi runtime state |
| `~/.pi/bloom-context.json` | compacted Bloom context |
| `~/.pi/matrix-credentials.json` | primary Matrix credentials |
| `~/.pi/matrix-agents/` | per-agent Matrix credentials |
| `~/.pi/pi-daemon/matrix-state.json` | single-agent Matrix sync state |
| `~/.pi/pi-daemon/matrix-agents/` | multi-agent Matrix sync state |
| `~/.pi/agent/sessions/bloom-rooms/` | daemon session directories |
| `~/.config/containers/systemd/` | installed Quadlet units |
| `~/.config/systemd/user/` | user socket units and user services |
| `~/.config/bloom/` | service env/config files |

## Extensions

### `bloom-persona`

Purpose:

- seed Bloom identity into Pi
- enforce shell guardrails
- persist compacted context

Hooks:

- `session_start` sets the session name to `Bloom`
- `before_agent_start` injects persona plus restored compacted context
- `tool_call` blocks matching `bash` commands using the compiled guardrail policy
- `session_before_compact` saves context and adds compaction guidance

Notes:

- guardrails are a safety net for obvious dangerous shell patterns, not a security boundary
- invalid regex entries in guardrail config are skipped with an error log

### `bloom-audit`

Purpose:

- append audit events to daily JSONL logs in `~/Bloom/audit/`
- rotate logs older than 30 days

Tools:

- `audit_review`

Hooks:

- `session_start`
- `tool_call`
- `tool_result`

### `bloom-os`

Purpose:

- host OS management for bootc, systemd, containers, and updates

Tools:

- `bootc`
- `container`
- `systemd_control`
- `system_health`
- `update_status`
- `schedule_reboot`

Hooks:

- `before_agent_start` injects pending-update guidance once per session

### `bloom-repo`

Purpose:

- bootstrap and sync the repo clone in `~/.bloom/pi-bloom`
- submit PRs through a fork/upstream workflow

Tools:

- `bloom_repo`
  - actions: `configure`, `status`, `sync`
- `bloom_repo_submit_pr`

### `bloom-services`

Purpose:

- scaffold service packages
- install packaged services
- manage declarative service state and Matrix bridges

Tools:

- `service_scaffold`
- `service_install`
- `service_test`
- `manifest_show`
- `manifest_sync`
- `manifest_set_service`
- `manifest_apply`
- `bridge_create`
- `bridge_remove`
- `bridge_status`

Hooks:

- `session_start` reports service and manifest status to the UI

Notes:

- `service_install` rebuilds `localhost/*` images during install instead of trusting an already-present mutable tag
- `manifest_apply` attempts persistent `enable --now` / `disable --now` first, then falls back to start/stop when the unit cannot be enabled
- corrupt `~/Bloom/manifest.yaml` files are moved aside to `manifest.yaml.corrupt-*` before Bloom recreates an empty manifest

### `bloom-objects`

Purpose:

- flat-file object store in `~/Bloom/Objects/`

Tools:

- `memory_create`
- `memory_read`
- `memory_search`
- `memory_link`
- `memory_list`

### `bloom-garden`

Purpose:

- create and seed the Bloom directory
- discover skills
- provision Matrix agents
- record persona evolutions

Tools:

- `garden_status`
- `skill_create`
- `skill_list`
- `agent_create`
- `persona_evolve`

Hooks / commands:

- `session_start`
- `resources_discover`
- `/bloom` with `init`, `status`, `update-blueprints`

### `bloom-dev`

Purpose:

- on-device developer workflow helpers

Tools:

- `dev_enable`
- `dev_disable`
- `dev_status`
- `dev_code_server`
- `dev_build`
- `dev_switch`
- `dev_rollback`
- `dev_loop`
- `dev_test`
- `dev_submit_pr`
- `dev_push_skill`
- `dev_push_service`
- `dev_push_extension`
- `dev_install_package`

Notes:

- most tools are gated by the dev sentinel in `~/.bloom/.dev-enabled`

### `bloom-setup`

Purpose:

- track Pi-side completion of the post-wizard persona setup

Tools:

- `setup_status`
- `setup_advance`
- `setup_reset`

Hooks:

- `before_agent_start` injects persona-setup guidance only after the bash wizard is complete and before the persona step
  is marked done

## Daemon

`pi-daemon.service` is the always-on Matrix daemon.

Current behavior:

- starts in single-agent mode if no agent overlays exist
- starts in multi-agent mode if at least one `~/Bloom/Agents/*/AGENTS.md` is valid
- skips malformed agent overlays with warnings instead of aborting startup
- keeps one room session per room in single-agent mode
- keeps one room session per `(room, agent)` pair in multi-agent mode
- prunes duplicate-event and reply-budget state over time so long-lived sessions stay bounded

Key daemon files:

| Path | Purpose |
|------|---------|
| `core/daemon/index.ts` | bootstrap and mode selection |
| `core/daemon/pi-room-session.ts` | Pi SDK-backed room session lifecycle |
| `core/daemon/agent-supervisor.ts` | multi-agent routing and session orchestration |
| `core/daemon/router.ts` | routing policy |
| `core/daemon/room-state.ts` | duplicate, cooldown, and reply-budget tracking |

## Bundled Skills

Bundled skill directories seeded into `~/Bloom/Skills/`:

- `first-boot`
- `object-store`
- `os-operations`
- `recovery`
- `self-evolution`
- `service-management`

## Bundled Service Packages

Current packages in `services/`:

| Package | Status |
|---------|--------|
| `dufs` | packaged service installable via `service_install` |
| `code-server` | packaged service with local image build flow |
| `_template` | scaffold source for new packages |

Additional service documentation in-tree:

| Path | Role |
|------|------|
| `services/matrix/SKILL.md` | Matrix infrastructure reference |
| `services/netbird/SKILL.md` | NetBird infrastructure reference |

## Safety and Trust

- shell command guardrails are loaded from `~/Bloom/guardrails.yaml` if present, else from the packaged default
- service manifests live in `~/Bloom/manifest.yaml`
- service image trust rules are documented in [docs/supply-chain.md](docs/supply-chain.md)
- PR-based repo workflow is documented in [docs/fleet-pr-workflow.md](docs/fleet-pr-workflow.md)

## Related Docs

- [README.md](README.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [docs/service-architecture.md](docs/service-architecture.md)
- [docs/quick_deploy.md](docs/quick_deploy.md)
- [docs/pibloom-setup.md](docs/pibloom-setup.md)
- [docs/fleet-pr-workflow.md](docs/fleet-pr-workflow.md)
- [docs/supply-chain.md](docs/supply-chain.md)
