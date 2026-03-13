# AGENTS.md

> 📖 [Emoji Legend](docs/LEGEND.md)

## 🌱 Bloom — Pi-Native OS Platform

Bloom is a Pi package that turns a Fedora bootc machine into a personal AI companion host. Pi IS the product; Bloom teaches Pi about its OS.

## 🌱 Extensibility Hierarchy

Bloom extends Pi through three mechanisms, lightest first: **Skill → Extension → Service**.

| Layer | What | When | Created By |
|-------|------|------|------------|
| **Skill** | Markdown instructions (SKILL.md) | Pi needs knowledge or a procedure | Pi or developer |
| **Extension** | In-process TypeScript | Pi needs commands, tools, or event hooks | Developer (PR required) |
| **Service** | Container (Podman Quadlet) | Standalone workload needing isolation | Pi or developer |

Always prefer the lightest option. See `docs/service-architecture.md` for details.

For reproducible releases and artifact trust rules, see `docs/supply-chain.md`.
For multi-device code contribution and PR flow, see `docs/fleet-pr-workflow.md`.

## 🧩 Extensions

```mermaid
sequenceDiagram
    participant Pi as 🤖 Pi Agent
    participant Ext as 🧩 Extensions
    participant Hooks as Event Hooks

    Pi->>Ext: Load extensions
    Ext->>Hooks: Register session_start hooks
    Ext->>Hooks: Register before_agent_start hooks
    Ext->>Hooks: Register tool_call / tool_result hooks
    Pi->>Hooks: Fire session_start
    Note over Hooks: bloom-persona sets session name<br/>bloom-audit rotates logs<br/>bloom-garden seeds blueprints
    Pi->>Hooks: Fire before_agent_start
    Note over Hooks: bloom-persona injects identity<br/>bloom-os injects update status
    Pi-->>Pi: Ready
```

```mermaid
sequenceDiagram
    participant User
    participant Pi as 🤖 Pi Agent
    participant Guard as 🛡️ Guardrails
    participant Tool as 🧩 Tool
    participant Audit as 🔍 Audit

    User->>Pi: Request
    Pi->>Guard: tool_call hook (check command)
    alt Blocked
        Guard-->>Pi: ❌ Pattern matched
        Pi-->>User: Action blocked by guardrails
    else Allowed
        Guard-->>Pi: ✅ Pass
        Pi->>Tool: Execute tool
        Pi->>Audit: tool_call event → JSONL
        Tool-->>Pi: Result
        Pi->>Audit: tool_result event → JSONL
        Pi-->>User: Response
    end
```

### 🪞 bloom-persona

Identity injection, safety guardrails, and compaction context.

**Hooks:**
- `session_start` — Set session name to "Bloom"
- `before_agent_start` — Inject 4-layer persona (SOUL/BODY/FACULTY/SKILL) + restored compaction context into system prompt
- `tool_call` — Check bash commands against guardrails, block if pattern matches
- `session_before_compact` — Save context (update status) to `~/.pi/bloom-context.json`

### 🔍 bloom-audit

Tool-call audit trail with 30-day retention.

**Tools:** `audit_review`
**Hooks:**
- `session_start` — Rotate audit logs, ensure audit directory
- `tool_call` — Append tool call event to daily JSONL
- `tool_result` — Append tool result event to daily JSONL

### 💻 bloom-os

OS management: bootc lifecycle, containers, systemd, health, updates.

**Tools:**
- Bootc: `bootc` (actions: status, check, download, apply, rollback)
- Containers: `container` (actions: status, logs, deploy)
- System: `systemd_control`, `system_health`
- Updates: `update_status`, `schedule_reboot`

**Hooks:**
- `before_agent_start` — Inject OS update availability into system prompt

### 🔀 bloom-repo

Repository management: configure, sync, submit PRs, check status.

**Tools:** `bloom_repo` (actions: configure, status, sync), `bloom_repo_submit_pr`

### 📦 bloom-services

Service lifecycle: scaffold, install, test, bridge management, and declarative manifest management.

**Tools:** `service_scaffold`, `service_install`, `service_test`, `bridge_create`, `bridge_remove`, `bridge_status`, `manifest_show`, `manifest_sync`, `manifest_set_service`, `manifest_apply`
**Hooks:**
- `session_start` — Set UI status, check manifest drift, display status widget

### 🗂️ bloom-objects

Flat-file object store with YAML frontmatter + Markdown in `~/Bloom/Objects/`.

**Tools:** `memory_create`, `memory_read`, `memory_search`, `memory_link`, `memory_list`

### 🌿 bloom-garden

Bloom directory management, blueprint seeding, skill creation, Matrix agent provisioning, persona evolution.

**Tools:** `garden_status`, `skill_create`, `skill_list`, `agent_create`, `persona_evolve`
**Commands:** `/bloom` (init | status | update-blueprints)
**Hooks:**
- `session_start` — Ensure Bloom directory structure, seed blueprints (hash-based change detection)
- `resources_discover` — Return skill paths from `~/Bloom/Skills/`

### 🛠️ bloom-dev

On-device development tools: build, test, switch, rollback, PR submission.

**Tools:** `dev_enable`, `dev_disable`, `dev_status`, `dev_code_server`, `dev_build`, `dev_switch`, `dev_rollback`, `dev_loop`, `dev_test`, `dev_submit_pr`, `dev_push_skill`, `dev_push_service`, `dev_push_extension`, `dev_install_package`

### 🚀 bloom-setup

First-boot setup wizard with guided steps.

**Tools:** `setup_status`, `setup_advance`, `setup_reset`
**Hooks:**
- `before_agent_start` — Inject first-boot skill into system prompt when setup is incomplete

### Pi Daemon (pi-daemon.service)

Always-on SDK-based daemon managing one `AgentSession` per Matrix room. Runs as a systemd user service after first-boot setup. The daemon and interactive terminal run in parallel — they share filesystem and persona but not sessions.

**Components:**
- `daemon/index.ts` — entry point, wires components
- `daemon/matrix-listener.ts` — Matrix bot-sdk client
- `daemon/session-pool.ts` — session lifecycle, LRU eviction (max 3 default)
- `daemon/room-registry.ts` — `rooms.json` room-to-session mapping

**Key paths:**
- `~/.pi/pi-daemon/rooms.json` — room registry
- `~/.pi/agent/sessions/bloom-rooms/` — daemon session files
- `~/.pi/pi-daemon/matrix-state.json` — Matrix client state

## 🧩 All Registered Tools (45)

Quick reference of every tool name available to Pi:

| Tool | Extension | Purpose |
|------|-----------|---------|
| `audit_review` | bloom-audit | Inspect recent audited tool activity |
| `bootc` | bloom-os | Bootc lifecycle (actions: status, check, download, apply, rollback) |
| `container` | bloom-os | Container management (actions: status, logs, deploy) |
| `systemd_control` | bloom-os | Start/stop/restart/status a service |
| `system_health` | bloom-os | Comprehensive health overview |
| `update_status` | bloom-os | Check if OS update is available |
| `schedule_reboot` | bloom-os | Schedule a delayed reboot |
| `bloom_repo` | bloom-repo | Repository management (actions: configure, status, sync) |
| `bloom_repo_submit_pr` | bloom-repo | Create PR from local changes |
| `service_scaffold` | bloom-services | Generate service package skeleton |
| `service_install` | bloom-services | Install service from bundled local package |
| `service_test` | bloom-services | Smoke-test installed service units |
| `bridge_create` | bloom-services | Create and configure a mautrix bridge |
| `bridge_remove` | bloom-services | Remove a bridge container and config |
| `bridge_status` | bloom-services | List running bridge containers |
| `manifest_show` | bloom-services | Display service manifest |
| `manifest_sync` | bloom-services | Reconcile manifest with running state |
| `manifest_set_service` | bloom-services | Declare service in manifest |
| `manifest_apply` | bloom-services | Apply desired state |
| `memory_create` | bloom-objects | Create new object in ~/Bloom/Objects/ |
| `memory_read` | bloom-objects | Read object by type/slug |
| `memory_search` | bloom-objects | Search objects by pattern |
| `memory_link` | bloom-objects | Add bidirectional links between objects |
| `memory_list` | bloom-objects | List objects (filter by type, frontmatter) |
| `garden_status` | bloom-garden | Show Bloom directory, file counts, blueprint state |
| `skill_create` | bloom-garden | Create new SKILL.md in ~/Bloom/Skills/ |
| `skill_list` | bloom-garden | List all skills in ~/Bloom/Skills/ |
| `agent_create` | bloom-garden | Provision a new Bloom Matrix agent account and write its AGENTS.md |
| `persona_evolve` | bloom-garden | Propose persona layer change |
| `dev_enable` | bloom-dev | Enable on-device development mode |
| `dev_disable` | bloom-dev | Disable on-device development mode |
| `dev_status` | bloom-dev | Check dev environment status |
| `dev_code_server` | bloom-dev | Start/stop/restart code-server |
| `dev_build` | bloom-dev | Build local container image |
| `dev_switch` | bloom-dev | Switch OS to a local/remote image |
| `dev_rollback` | bloom-dev | Rollback to previous OS deployment |
| `dev_loop` | bloom-dev | Build → switch → reboot loop |
| `dev_test` | bloom-dev | Run tests and linting |
| `dev_submit_pr` | bloom-dev | Submit PR from local changes |
| `dev_push_skill` | bloom-dev | Push skill to repo and open PR |
| `dev_push_service` | bloom-dev | Push service to repo and open PR |
| `dev_push_extension` | bloom-dev | Push extension to repo and open PR |
| `dev_install_package` | bloom-dev | Install Pi package from local path |
| `setup_status` | bloom-setup | Show first-boot setup progress |
| `setup_advance` | bloom-setup | Mark setup step as completed/skipped |
| `setup_reset` | bloom-setup | Reset a setup step or full setup |

## 📜 Skills

| Skill | Purpose |
|-------|---------|
| `first-boot` | One-time system setup (LLM provider, GitHub auth, repo, services, sync) |
| `os-operations` | System health inspection and remediation (bootc, containers, systemd) |
| `object-store` | CRUD operations for the memory store |
| `service-management` | Install, manage, and discover bundled service packages |
| `self-evolution` | Structured system change workflow |
| `recovery` | Troubleshooting playbooks (Matrix, OS updates, dufs, disk, containers) |

## 📦 Services & Infrastructure

### OS-Level Infrastructure (baked into OS image)

| Unit | Purpose | Type |
|------|---------|------|
| `bloom-matrix.service` | Continuwuity Matrix homeserver | Native systemd |
| `netbird.service` | Mesh VPN networking | System RPM |

### Subdomain Routing (`bloom.mesh`)

Services get automatic subdomain access via `{name}.bloom.mesh` when a NetBird API token is configured:

1. **DNS**: `ensureServiceRecord` creates an A record in the NetBird `bloom.mesh` custom DNS zone

Services use host networking and are accessible directly at `http://{name}.bloom.mesh:{port}` from any mesh peer. No reverse proxy is needed.

Graceful degradation: no token = DNS skipped. Services remain accessible via the device's mesh IP and port directly.

Token location: `~/.config/bloom/netbird.env` (`NETBIRD_API_TOKEN=nbp_...`)

### Container Services

Canonical metadata for automation lives in `services/catalog.yaml`.

| Service | Category | Port | Subdomain | Type |
|---------|----------|------|-----------|------|
| `bloom-dufs` | sync | 5000 | `dufs.bloom.mesh` | Podman Quadlet |

### Bridges (on-demand via `bridge_create`)

| Bridge | Image | Health Port |
|--------|-------|-------------|
| whatsapp | `dock.mau.dev/mautrix/whatsapp:v26.02` | 29318 |
| telegram | `dock.mau.dev/mautrix/telegram:v0.15.3` | 29300 |
| signal | `dock.mau.dev/mautrix/signal:v26.02.2` | 29328 |

## 🪞 Persona

OpenPersona 4-layer identity in `persona/`, seeded to `~/Bloom/Persona/` on first boot:
- `SOUL.md` — Identity, values, voice, boundaries
- `BODY.md` — Channel adaptation, presence behavior
- `FACULTY.md` — Reasoning patterns, decision frameworks
- `SKILL.md` — Current capabilities, tool preferences

### 🌿 Bloom Directory Structure

```mermaid
graph LR
    Bloom["🌿 ~/Bloom/"] --> Persona["🪞 Persona/"]
    Bloom --> Skills["📜 Skills/"]
    Bloom --> Evolutions[Evolutions/]
    Bloom --> Objects["🗂️ Objects/"]

    style Bloom fill:#e8d5f5
```

## 📖 Shared Library

See `ARCHITECTURE.md` for structural rules and enforcement checklist.

`lib/` — pure logic organized by capability:

| File | Key Exports |
|------|-------------|
| `shared.ts` | `createLogger`, `truncate`, `errorResult`, `requireConfirmation`, `nowIso`, `guardBloom` |
| `frontmatter.ts` | `parseFrontmatter`, `stringifyFrontmatter`, `yaml` |
| `filesystem.ts` | `safePath`, `getBloomDir` |
| `exec.ts` | `run` (command execution, supports stdin `input`) |
| `git.ts` | `parseGithubSlugFromUrl`, `slugifyBranchPart` |
| `repo.ts` | `getRemoteUrl`, `inferRepoUrl` |
| `audit.ts` | `dayStamp`, `sanitize`, `summarizeInput` |
| `services-catalog.ts` | `loadServiceCatalog`, `loadBridgeCatalog`, `servicePreflightErrors`, `findLocalServicePackage` |
| `services-manifest.ts` | `loadManifest`, `saveManifest` |
| `services-validation.ts` | `validateServiceName`, `validatePinnedImage`, `commandExists`, `hasSubidRange` |
| `matrix.ts` | `extractResponseText`, `generatePassword`, `matrixCredentialsPath`, `registerMatrixAccount`, `MatrixCredentials` |
| `setup.ts` | `STEP_ORDER`, `createInitialState`, `advanceStep`, `getNextStep`, `isSetupComplete`, `getStepsSummary` |

## 🚀 Install

```bash
pi install /path/to/bloom
```

Or for development (loads all extensions from the `extensions/` directory):
```bash
pi install ./
```

## 📖 Setup & Deployment Docs

- OS build/deploy/install: `docs/quick_deploy.md`
- First-boot setup flow: `docs/pibloom-setup.md`
- Fleet PR workflow: `docs/fleet-pr-workflow.md`
- Service architecture: `docs/service-architecture.md`
- Supply chain trust: `docs/supply-chain.md`

## 🔗 Related

- [Emoji Legend](docs/LEGEND.md) — Notation reference
- [Service Architecture](docs/service-architecture.md) — Extensibility hierarchy details
