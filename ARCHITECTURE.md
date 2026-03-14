# ARCHITECTURE.md

Bloom's current architecture and repository rules.

## Product Shape

Bloom has three layers:

| Layer | What it is | Typical use |
|------|-------------|-------------|
| Skill | markdown instructions in `SKILL.md` | procedures, guidance, checklists |
| Extension | in-process TypeScript | Pi-facing tools, hooks, commands |
| Service | packaged container workload | isolated long-running software |

Bloom also ships OS-level infrastructure that is part of the image rather than a service package:

- `bloom-matrix.service`
- `netbird.service`
- `pi-daemon.service`

## Repository Structure

```text
core/         Bloom core: OS image, daemon, persona, skills, built-in extensions, runtime helpers
extensions/   non-core Pi extensions
cli/          local command-line helpers
services/     bundled service packages and template
tests/        unit, integration, and daemon tests
docs/         live documentation only
```

## Extension Conventions

Every extension lives in its own directory:

```text
core/extensions/bloom-{name}/
or extensions/bloom-{name}/
  index.ts
  actions*.ts
  types.ts
```

Rules:

1. `index.ts` is the registration entry point.
2. Tool handlers and hook logic live in `actions.ts` or focused `actions-*.ts` files.
3. `types.ts` is optional but preferred when the extension owns non-trivial types.
4. Core runtime helpers belong in `core/lib/`. Non-core shared helpers can remain outside `core/` only when they truly support optional extensions.

Current exception worth documenting honestly:

- some extensions still keep light gating or setup helpers in `index.ts`
- some `core/lib/` modules perform filesystem or process work, so it should be read as shared library code, not as a
  strictly pure functional layer

## Shared Library

`core/lib/` currently mixes three kinds of modules:

- pure data/format helpers such as `frontmatter.ts`, `audit.ts`, and most of `setup.ts`
- path and environment helpers such as `filesystem.ts`
- host-aware helpers that may read files or execute commands such as `services-catalog.ts`, `services-manifest.ts`,
  `services-validation.ts`, and `repo.ts`

Rule:

- keep reusable core logic in `core/lib/`, but do not claim purity unless the module is actually side-effect free

## Daemon

The daemon is a first-class part of the current architecture.

### Entry Points

| Path | Role |
|------|------|
| `core/daemon/index.ts` | daemon bootstrap and mode selection |
| `core/daemon/matrix-listener.ts` | single-agent Matrix client |
| `core/daemon/matrix-client-pool.ts` | per-agent Matrix clients for multi-agent mode |
| `core/daemon/pi-room-session.ts` | Pi SDK-backed room session lifecycle |
| `core/daemon/agent-supervisor.ts` | room routing, typing, session lifecycle, sequential handoff |

### Runtime Model

1. The daemon starts in single-agent fallback mode when no agent overlays exist.
2. The daemon starts in multi-agent mode when at least one `~/Bloom/Agents/*/AGENTS.md` parses successfully.
3. Malformed agent overlays are skipped with warnings instead of aborting daemon startup.
4. Duplicate-event, cooldown, and per-root reply state is bounded and pruned over time for long-lived daemon sessions.
5. Pi SDK session events are fanned out to Matrix and Bloom routing logic.
6. Idle room sessions are disposed after `BLOOM_DAEMON_IDLE_TIMEOUT_MS` unless more traffic arrives.
7. During supervisor shutdown, new sequential multi-agent handoffs are suppressed so room shutdown cannot enqueue fresh work.

This is custom Bloom orchestration code and should be treated as such when reviewing changes.

## Bloom Directory

Bloom seeds and manages the following under `~/Bloom/` unless `BLOOM_DIR` overrides it:

```text
Persona/
Skills/
Evolutions/
Objects/
Agents/
audit/
guardrails.yaml
manifest.yaml
blueprint-versions.json
```

## Service Packages

Service packages live in `services/{name}/` and usually contain:

```text
Containerfile            optional, required for locally built images
SKILL.md                 required
quadlet/                 required
```

The current repository includes packaged services for `dufs` and `code-server`, plus a reusable `_template`.

Rules:

1. Use `Containerfile`, never `Dockerfile`.
2. Use `podman`, never `docker`.
3. Use `bloom-{name}` for Bloom-managed unit names.
4. Prefer pinned image tags or digests for published images.
5. Document any mutable local-image exception explicitly and make rebuild behavior explicit in docs.

## Documentation Policy

Only keep live documentation in the main docs tree.

Rules:

1. Root docs and `docs/*.md` should describe the current repository state.
2. Delete stale design archives instead of letting them compete with live docs.
3. When code changes user-facing tools, hooks, paths, daemon behavior, setup flow, or service workflow, update:
   - `README.md`
   - `AGENTS.md`
   - any directly affected guide in `docs/`

## Review Checklist

- Does the change match the current daemon and service model rather than an older one?
- Are docs updated to reflect the actual runtime behavior?
- Are obsolete files removed instead of preserved as dead history?
- Are user-facing tool names, paths, and workflows still correct?
