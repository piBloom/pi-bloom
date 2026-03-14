# Service Architecture

> 📖 [Emoji Legend](LEGEND.md)

This document describes Bloom's current capability model and the service packaging approach that exists in this
repository today.

## Capability Hierarchy

Use the lightest mechanism that solves the problem.

| Layer | When to use it | Current examples |
|------|-----------------|------------------|
| Skill | Pi needs instructions, reference material, or a repeatable procedure | `first-boot`, `recovery`, `service-management` |
| Extension | Pi needs tools, hooks, commands, or direct session integration | `bloom-os`, `bloom-services`, `bloom-garden` |
| Service | a standalone workload should run outside the Pi process | `dufs`, `code-server`, Matrix bridges |

OS-level infrastructure sits beside this model rather than inside it:

- `bloom-matrix.service`
- `netbird.service`
- `pi-daemon.service`

Repository shape:

- `core/` contains Bloom's built-in platform and product code
- `extensions/` contains non-core/operator extensions

## Skills

Bundled skill directories in `core/skills/` are seeded into `~/Bloom/Skills/` by `bloom-garden`:

- `first-boot`
- `object-store`
- `os-operations`
- `recovery`
- `self-evolution`
- `service-management`

Skills can also be created dynamically through `skill_create`.

## Extensions

Extensions are the Pi-facing integration layer. They register:

- tools
- session hooks
- commands
- resource discovery

Current extension families:

| Extension | Main responsibility |
|-----------|---------------------|
| `bloom-persona` | persona injection, guardrails, compacted context |
| `bloom-audit` | audit logging and review |
| `bloom-os` | bootc, container, systemd, and health workflows |
| `bloom-repo` | repo bootstrap, sync, and PR creation |
| `bloom-services` | service and bridge lifecycle |
| `bloom-objects` | object store |
| `bloom-garden` | Bloom directory, skills, agents, blueprint seeding |
| `bloom-dev` | on-device dev workflows |
| `bloom-setup` | persona-step progress after the first-boot wizard |

## Service Packages

Service packages are the optional container workloads shipped in `services/`.

### Package Layout

Typical package:

```text
services/{name}/
  SKILL.md
  quadlet/
    bloom-{name}.container
  Containerfile          optional, required for locally built images
```

`service_install` copies package assets into the user's runtime locations:

- Quadlet units to `~/.config/containers/systemd/`
- socket units, when present, to `~/.config/systemd/user/`
- `SKILL.md` to `~/Bloom/Skills/{name}/`
- config files to `~/.config/bloom/`

### Bundled Packages

| Package | Image source | Notes |
|---------|--------------|-------|
| `dufs` | pinned upstream image | packaged network file server |
| `code-server` | local image `localhost/bloom-code-server:latest` | built from `services/code-server/Containerfile` when needed |
| `_template` | scaffold source | basis for new service packages |

Reference-only infrastructure skill docs also live under `services/`:

- `services/matrix/SKILL.md`
- `services/netbird/SKILL.md`

### Catalog

`services/catalog.yaml` is the machine-readable catalog used by Bloom:

- `services:` contains package metadata such as version, category, image, port, and preflight commands
- `bridges:` contains Matrix bridge image metadata

## Manifest Workflow

Bloom keeps desired service state in `~/Bloom/manifest.yaml`.

Tools:

- `manifest_show`
- `manifest_sync`
- `manifest_set_service`
- `manifest_apply`

Current behavior:

- `manifest_apply` can install missing packaged services
- service state is reconciled through user systemd / Quadlet units
- manifest entries may be updated by service installation and dependency installation flows

## Matrix Bridges

Bridge lifecycle is managed through `bloom-services`.

Current supported bridge names from `services/catalog.yaml`:

- `whatsapp`
- `telegram`
- `signal`

Bridge creation currently:

- writes a Quadlet unit
- writes starter bridge config
- points the bridge at the local Matrix homeserver
- starts the bridge service

## Daemon and Services

The room daemon is not a service package. It is OS-level infrastructure that coordinates Pi sessions for Matrix rooms.

Keep this distinction clear:

- daemon: core platform runtime
- service packages: optional user workloads

## Related

- [README.md](../README.md)
- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [docs/supply-chain.md](supply-chain.md)
- [services/README.md](../services/README.md)
