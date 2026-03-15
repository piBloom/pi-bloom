# Service Architecture

> 📖 [Emoji Legend](LEGEND.md)

Audience: maintainers and operators deciding how Bloom capabilities should be packaged.

## 🌱 Why This Capability Model Exists

Bloom uses multiple extension mechanisms because not every problem should become a container or a TypeScript tool.

The rule is simple: use the lightest mechanism that solves the problem.

## 🧩 How To Choose The Right Layer

| Layer | When to use it | Current examples |
|------|-----------------|------------------|
| 📜 Skill | Pi needs instructions, reference material, or a repeatable procedure | `first-boot`, `recovery`, `service-management` |
| 🧩 Extension | Pi needs tools, hooks, commands, or direct session integration | `bloom-os`, `bloom-services`, `bloom-garden` |
| 📦 Service | a standalone workload should run outside the Pi process | `dufs`, `code-server`, Matrix bridges |

OS-level infrastructure sits beside this model rather than inside it:

- `Bloom Home` on port `8080`
- `bloom-matrix.service`
- `netbird.service`
- `pi-daemon.service`

### Skills

Bundled skill directories in `core/pi-skills/` are seeded into `~/Bloom/Skills/` by `bloom-garden`:

- `first-boot`
- `object-store`
- `os-operations`
- `recovery`
- `self-evolution`
- `service-management`

### Extensions

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
| `bloom-episodes` | episodic memory |
| `bloom-objects` | durable object store |
| `bloom-garden` | Bloom directory, skills, agents, blueprint seeding |
| `bloom-dev` | on-device dev workflows |
| `bloom-setup` | persona-step progress after the first-boot wizard |

### Service Packages

Service packages are the optional container workloads shipped in `services/`.

Typical package:

```text
services/{name}/
  SKILL.md
  quadlet/
    bloom-{name}.container
  Containerfile          optional, required for locally built images
```

`service_install` copies package assets into runtime locations:

- Quadlet units to `~/.config/containers/systemd/`
- socket units, when present, to `~/.config/systemd/user/`
- `SKILL.md` to `~/Bloom/Skills/{name}/`
- config files to `~/.config/bloom/`

## 📦 Reference

Bundled packages:

| Package | Image source | Notes |
|---------|--------------|-------|
| `cinny` | pinned upstream image | optional Bloom Web Chat client on port `8081` |
| `dufs` | pinned upstream image | packaged WebDAV file server on port `5000` |
| `code-server` | local image `localhost/bloom-code-server:latest` | built from `services/code-server/Containerfile` and exposed on port `8443` |
| `_template` | scaffold source | basis for new service packages |

Machine-readable catalog:

- `services/catalog.yaml` contains packaged service and bridge metadata

Current manifest workflow:

- desired service state lives in `~/Bloom/manifest.yaml`
- `manifest_show`, `manifest_sync`, `manifest_set_service`, and `manifest_apply` operate on that state
- `manifest_apply(dry_run=true)` reports planned installs and unit actions without mutating the host
- reconciliation occurs through user systemd / Quadlet units

Current bridge names from `services/catalog.yaml`:

- `whatsapp`
- `telegram`
- `signal`

Keep this distinction clear:

- daemon: core platform runtime
- Bloom Home: image-baked access page generated from installed web services
- service packages: optional user workloads

## 🔗 Related

- [../README.md](../README.md)
- [../AGENTS.md](../AGENTS.md)
- [../services/README.md](../services/README.md)
- [daemon-architecture.md](daemon-architecture.md)
- [supply-chain.md](supply-chain.md)
