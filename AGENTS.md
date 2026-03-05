# AGENTS.md

## Bloom — Pi-Native OS Platform

Bloom is a Pi package that turns a Fedora bootc machine into a personal AI companion host. Pi IS the product; Bloom teaches Pi about its OS.

## Extensibility Hierarchy

Bloom extends Pi through three mechanisms, lightest first: **Skill → Extension → Service**.

| Layer | What | When | Created By |
|-------|------|------|------------|
| **Skill** | Markdown instructions (SKILL.md) | Pi needs knowledge or a procedure | Pi or developer |
| **Extension** | In-process TypeScript | Pi needs commands, tools, or event hooks | Developer (PR required) |
| **Service** | OCI container (Podman Quadlet) | Standalone workload needing isolation | Pi or developer |

Always prefer the lightest option. See `docs/service-architecture.md` for details.

For reproducible releases and artifact trust rules, see `docs/supply-chain.md`.

## Extensions

| Extension | Purpose | LOC |
|-----------|---------|-----|
| `bloom-persona` | Identity injection, safety guardrails, compaction guidance | ~73 |
| `bloom-audit` | Tool-call audit trail, retention, and review tooling | ~180 |
| `bloom-os` | bootc, Podman, systemd management tools | ~212 |
| `bloom-services` | Service lifecycle tooling (scaffold, publish, install, test) | ~420 |
| `bloom-objects` | Flat-file object store (YAML frontmatter + Markdown) | ~330 |
| `bloom-journal` | Daily journal entries (user + AI) | ~90 |
| `bloom-garden` | Garden vault, blueprint seeding, skill creation, persona evolution | ~310 |
| `bloom-channels` | Channel bridge Unix socket server, WhatsApp command | ~193 |
| `bloom-topics` | Topic management, /topic command, topic guidance | ~140 |

## Skills

| Skill | Purpose |
|-------|---------|
| `os-operations` | System health inspection and remediation |
| `object-store` | CRUD operations for the memory store |
| `self-evolution` | Structured system change workflow |
| `service-management` | Install, manage, and discover OCI service packages |
| `first-boot` | One-time system setup guide |

## Services (OCI Packages)

Modular capabilities packaged as OCI artifacts, installed via `oras` from GHCR.

| Service | Category | Port | Image |
|---------|----------|------|-------|
| `bloom-svc-whisper` | media | 9000 | fedirz/faster-whisper-server@sha256:760e5e43d427dc6cfbbc4731934b908b7de9c7e6d5309c6a1f0c8c923a5b6030 |
| `bloom-svc-whatsapp` | communication | — | ghcr.io/alexradunet/bloom-whatsapp:latest *(private GHCR digest not publicly resolvable)* |
| `bloom-svc-tailscale` | networking | — | tailscale/tailscale@sha256:95e528798bebe75f39b10e74e7051cf51188ee615934f232ba7ad06a3390ffa1 |

## Persona

OpenPersona 4-layer identity in `persona/`:
- `SOUL.md` — Identity, values, voice, boundaries
- `BODY.md` — Channel adaptation, presence behavior
- `FACULTY.md` — Reasoning patterns, PARA methodology
- `SKILL.md` — Current capabilities, tool preferences

## Install

```bash
pi install /path/to/bloom
```

Or for development:
```bash
pi -e ./extensions/bloom-persona.ts -e ./extensions/bloom-audit.ts -e ./extensions/bloom-os.ts -e ./extensions/bloom-services.ts -e ./extensions/bloom-objects.ts -e ./extensions/bloom-journal.ts -e ./extensions/bloom-garden.ts -e ./extensions/bloom-channels.ts -e ./extensions/bloom-topics.ts
```
