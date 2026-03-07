# CLAUDE.md

## Project

Bloom — Pi-native OS platform on Fedora bootc. Pi IS the product. Bloom is the OS concept — a Fedora bootc image that makes Pi a first-class citizen with extensions teaching it about its host.
The bloom word comes from the concept that you "plant" your mini-pc and then in time it grows and blooms with you.

## Architecture

Bloom extends Pi through three mechanisms, lightest first: **Skill → Extension → Service**.

- **Pi package**: Extensions + skills bundled as a Pi package (`pi install ./`)
- **Extensions**: `extensions/` — 9 TypeScript Pi extensions (bloom-persona, bloom-audit, bloom-os, bloom-repo, bloom-services, bloom-objects, bloom-garden, bloom-channels, bloom-topics)
- **Shared lib**: `lib/shared.ts` — utilities used across extensions (parseFrontmatter, stringifyFrontmatter, getBloomDir, createLogger, truncate, errorResult, nowIso)
- **Skills**: `skills/` — 6 Pi skill markdown files (first-boot, os-operations, object-store, service-management, self-evolution, recovery)
- **Services**: `services/` — containerized (lemonade, dufs, whatsapp) services. NetBird is a system RPM. Metadata in `services/catalog.yaml`
- **Persona**: `persona/` — OpenPersona 4-layer identity (SOUL.md, BODY.md, FACULTY.md, SKILL.md) — seeded to `~/Bloom/` on first run
- **Guardrails**: `guardrails.yaml` — bash patterns blocked by bloom-persona (rm -rf, mkfs, dd, fork bombs, eval, pipe-to-shell, force-push, etc.)
- **User home**: `$HOME` — the user's space, accessible via dufs WebDAV
- **Bloom directory**: `~/Bloom/` — persona, skills, evolutions, guardrails, objects (synced). Env override: `BLOOM_DIR`
- **Pi state**: `~/.pi/` — internal agent state, sessions, settings (NOT synced)
- **OS image**: `os/Containerfile` — Fedora bootc 42

## Key Paths

| Path | Purpose | Synced |
|------|---------|--------|
| `$HOME` | User's home directory | Yes (dufs WebDAV) |
| `~/Bloom/` | Bloom config: persona, skills, evolutions, guardrails | Yes |
| `~/Bloom/Persona/` | Active persona files | Yes |
| `~/Bloom/Skills/` | Installed skills | Yes |
| `~/Bloom/Evolutions/` | Proposed persona changes | Yes |
| `~/Bloom/Objects/` | Tracked objects (notes, tasks, etc.) | Yes |
| `~/.pi/` | Pi agent state, sessions | No |
| `~/.pi/bloom-context.json` | Compaction context persistence | No |
| `~/.config/containers/systemd/` | Quadlet container units | No |
| `$XDG_RUNTIME_DIR/bloom/channels.sock` | Channel bridge Unix socket | No |

## Build and Test

```bash
npm install                    # install dev deps
npm run build                  # tsc --build
npm run check                  # biome lint + format check
npm run check:fix              # biome auto-fix
npm run test                   # vitest run
npm run test:watch             # vitest watch mode
npm run test:coverage          # vitest with v8 coverage (80% threshold)
```

### OS Image Build & VM Testing

Requires: `sudo dnf install just qemu-system-x86 edk2-ovmf`

```bash
just build                     # podman build container image
just qcow2                     # generate qcow2 disk image (BIB)
just iso                       # generate anaconda-iso installer (BIB)
just vm                        # boot qcow2 in QEMU (graphical + SSH :2222)
just vm-serial                 # boot qcow2 serial-only (no GUI)
just vm-ssh                    # ssh -p 2222 bloom@localhost
just vm-kill                   # stop running VM
just clean                     # remove os/output/
```

## Conventions

- **TypeScript**: strict, ES2022, NodeNext
- **Formatting**: Biome (tabs, double quotes, 120 line width)
- **Extensions**: `export default function(pi: ExtensionAPI) { ... }` pattern
- **Skills**: SKILL.md with frontmatter (name, description)
- **Containers**: `Containerfile` (not Dockerfile), `podman` (not docker)
- **Services**: Quadlet units named `bloom-{name}`, `bloom.network` isolation, health checks required
- **Objects**: Markdown files with YAML frontmatter in ~/Bloom/Objects/

## Documentation Workflow

When changing code:
1. TDD — Write failing test first
2. Implement — Make it pass
3. JSDoc — Update/add JSDoc on changed exports
4. Docs — If change affects tools, hooks, or architecture, update the relevant doc
5. Links — If adding a new doc, add cross-references from related docs

Canonical locations: tool/hook reference → `AGENTS.md`, architecture → `docs/service-architecture.md`, emoji legend → `docs/LEGEND.md`

## Do Not

- Add eslint, prettier, or formatting tools besides Biome
- Use `Dockerfile` naming — always `Containerfile`
- Use `docker` CLI — always `podman`
- Import from pi SDK at runtime — use `peerDependencies` only
