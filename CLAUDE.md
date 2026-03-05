# CLAUDE.md

## Project

Bloom — Pi-native OS platform on Fedora bootc. Pi IS the product. Bloom is the OS concept — a Fedora bootc image that makes Pi a first-class citizen with extensions teaching it about its host.
The bloom word comes from the concept that you "plant" your mini-pc and then in time it grows and blooms with you.

## Architecture

- **Pi package**: Extensions + skills bundled as a Pi package (`pi install ./`)
- **Extensions**: `extensions/` — TypeScript Pi extensions (bloom-garden, bloom-persona, bloom-os, bloom-objects, bloom-journal, bloom-channels, bloom-topics)
- **Skills**: `skills/` — Pi skill markdown files (os-operations, object-store, self-evolution, service-management, first-boot)
- **Services**: `services/` — OCI-packaged containers (whisper, whatsapp, tailscale, syncthing)
- **Persona**: `persona/` — OpenPersona 4-layer identity (SOUL.md, BODY.md, FACULTY.md, SKILL.md) — seeded to Garden on first run
- **Garden vault**: `~/Garden/` — PARA-organized user content, synced via Syncthing. Env: `BLOOM_GARDEN_DIR`
- **Bloom system**: `~/Garden/Bloom/` — shareable persona, skills, evolutions (synced)
- **Pi state**: `~/.pi/` — internal agent state, sessions, settings (NOT synced)
- **OS image**: `os/Containerfile` — Fedora bootc 42

## Build and Test

```bash
npm install                    # install dev deps
npm run build                  # tsc --build
npm run check                  # biome lint + format check
npm run check:fix              # biome auto-fix
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
- **Formatting**: Biome (tabs, double quotes)
- **Extensions**: `export default function(pi: ExtensionAPI) { ... }` pattern
- **Skills**: SKILL.md with frontmatter (name, description)
- **Containers**: `Containerfile` (not Dockerfile), `podman` (not docker)

## Do Not

- Add eslint, prettier, or formatting tools besides Biome
- Use `Dockerfile` naming — always `Containerfile`
- Use `docker` CLI — always `podman`
- Import from pi SDK at runtime — use `peerDependencies` only
