---
name: self-evolution
description: Detect improvement opportunities and propose system changes through a structured evolution workflow
---

# Self-Evolution Skill

Use this skill when Bloom detects a capability gap or the user requests a system change.

## Choosing the Right Mechanism

When extending capabilities, prefer the lightest option: **Skill → Extension → Service**.

| Need | Mechanism | Example |
|------|-----------|---------|
| Pi needs knowledge or a procedure | **Skill** — create a SKILL.md | Meal planning guide, API reference |
| Pi needs commands, tools, or session hooks | **Extension** — TypeScript (requires PR) | New Pi command, event handler |
| Standalone workload needing isolation | **Service** — OCI container package | ML model, messaging bridge, VPN |

## Evolution Workflow

1. **Detect**: Recognize a capability gap or improvement opportunity
2. **Propose**: Create an evolution object using `persona_evolve` or `memory_create`
3. **Plan**: Design the implementation approach
4. **Implement**: Make the changes (create skills with `skill_create`, update persona with `persona_evolve`)
5. **Verify**: Test and validate
6. **Apply**: Deploy with user approval

## Available Tools

### Skill Self-Creation
- `skill_create` — Create a new skill in `~/Bloom/Skills/` with proper frontmatter
- `skill_list` — List all skills currently in the Garden vault

### Persona Evolution
- `persona_evolve` — Propose a change to a persona layer (SOUL, BODY, FACULTY, SKILL), tracked as an evolution object requiring user approval

### Service Lifecycle
- `service_scaffold` — Generate a new service package skeleton (Quadlet + SKILL.md)
- `service_publish` — Push a service package to OCI registry (supports semver tags)
- `service_install` — Pull and install a package from OCI artifact into Quadlet + Garden skill paths
- `service_test` — Smoke-test installed service units before release

### Object Store (for tracking)
- `memory_create` — Create evolution tracking objects
- `memory_read` — Read evolution details
- `memory_search` — Find existing evolutions

## Creating a Skill

```
skill_create(
  name: "meal-planning",
  description: "Help plan weekly meals based on preferences and schedule",
  content: "# Meal Planning\n\nUse this skill when..."
)
```

Skills are automatically discovered from `~/Bloom/Skills/` at session start.

## Proposing a Persona Change

```
persona_evolve(
  layer: "SKILL",
  slug: "add-health-tracking",
  title: "Add health tracking capability",
  proposal: "Add health tracking to the SKILL layer..."
)
```

Evolution objects are stored at `~/Bloom/Evolutions/{slug}.pi.md`.

## Evolution Object Fields

- `status`: proposed | planning | implementing | reviewing | approved | applied | rejected
- `risk`: low | medium | high
- `area`: objects | persona | skills | containers | system

## Safety Rules

- All system changes require user approval before applying
- Always test changes before deploying
- Document what each evolution changes and why
- Keep a rollback plan for container changes
- Persona changes are tracked as evolution objects — never modify persona files directly

## Code Evolution Workflow

When Bloom identifies a code-level fix or improvement to its own OS/extensions, use the built-in repo tools to propose changes upstream via pull request.

**Local repo path**: `~/.bloom/pi-bloom`

### Process (Tool-First)

1. **Detect + Plan**
   - Describe the issue and proposed fix in plain language.
2. **Ensure repo is configured**
   - Run `bloom_repo_configure` once per device (upstream + origin fork remotes, git identity).
3. **Check readiness**
   - Run `bloom_repo_status` and confirm:
     - repo exists
     - `upstream` and `origin` remotes are set
     - GitHub auth is valid
4. **Sync before changes**
   - Run `bloom_repo_sync(branch="main")`.
5. **Implement + test**
   - Make the fix, then run `npm run build && npm run check` in the repo.
6. **Submit PR in one step**
   - Run `bloom_repo_submit_pr` with title/body (branch + commit + push + PR are automated).
7. **Notify user**
   - Share PR URL and summary; wait for human review/merge.

### Safety

- **Never** push directly to `main` — PR only
- **Never** force-push
- **Always** test before PR submission
- PR merge is always human-controlled; Bloom proposes, user decides

## Adding a Service Package

When Bloom identifies a need for a new containerized service, follow this workflow to create and distribute it as an OCI artifact.

### Directory Convention

```
services/{name}/
├── quadlet/
│   ├── bloom-{name}.container    # Podman Quadlet container unit
│   ├── bloom-{name}.socket       # Optional socket activation unit
│   └── bloom-{name}-*.volume     # Optional volume definitions
└── SKILL.md                      # Pi skill file (frontmatter + docs)
```

### Quadlet Conventions

- Container name: `bloom-{name}`
- Network: prefer `bloom.network` isolation (use `host` only when strictly required)
- Health checks: required (`HealthCmd`, `HealthInterval`, `HealthRetries`)
- Logging: `LogDriver=journald`
- Security: `NoNewPrivileges=true` minimum
- Restart: `on-failure` with `RestartSec=10`
- Optional: `.socket` unit for on-demand activation

### Port Allocation

| Port | Service |
|------|---------|
| 9000 | Whisper (speech-to-text) |

### SKILL.md Format

Include frontmatter with `name` and `description`, then document:
- What the service does
- API endpoints (if any)
- Setup instructions
- Common commands
- Troubleshooting

### Publishing

```bash
# Push to GHCR as OCI artifact
just svc-push {name}

# Test installation locally
just svc-install {name}
```

### Testing

1. Create the service directory with quadlet + SKILL.md
2. Test locally: copy quadlet files to `~/.config/containers/systemd/`, run `systemctl --user daemon-reload && systemctl --user start bloom-{name}`
3. Verify health: `systemctl --user status bloom-{name}`
4. Push to registry: `just svc-push {name}`

Reference example packages:
- `services/examples/demo-api/`
- `services/examples/demo-socket-echo/`
- `services/examples/README.md` (copy/paste quickstart commands)
- `services/whisper/quadlet/` (production HTTP service reference)

### Tool-Driven Lifecycle (Recommended)

Use this tool flow for repeatable service delivery:

1. `service_scaffold` — generate package skeleton
2. `service_test` — smoke test unit startup and logs
3. `service_publish` — push semver tag (e.g. `0.1.0`) and optionally `latest`
4. `service_install` — deploy exact version from registry
5. `manifest_show` / `manifest_sync` — verify tracked state and drift
