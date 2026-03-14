# CLAUDE.md

Bloom contributor quick reference.

## Project

Bloom is a Pi package plus Fedora bootc image. This repo contains:

- Pi extensions and bundled skills
- the Bloom room daemon
- bundled service packages
- the OS image build and first-boot assets

Canonical docs:

- structure and architectural rules: `ARCHITECTURE.md`
- tools, hooks, paths, daemon, and feature reference: `AGENTS.md`
- service and packaging model: `docs/service-architecture.md`

## Daily Commands

```bash
npm install
npm run build
npm run check
npm run test
npm run test:coverage
```

OS image workflow:

```bash
just build
just qcow2
just iso
just vm
just vm-ssh
just vm-kill
just clean
```

## Current Conventions

- use `Containerfile`, never `Dockerfile`
- use `podman`, never `docker`
- keep docs aligned with current code, not historical intent
- delete stale docs and dead files instead of preserving them as passive clutter
- update root docs and affected guides whenever tools, hooks, setup flow, service packaging, or daemon behavior changes

## Important Paths

| Path | Purpose |
|------|---------|
| `core/` | Bloom core: OS image, daemon, persona, skills, built-in extensions, runtime helpers |
| `extensions/` | non-core Pi extensions |
| `services/` | packaged services and template |
| `tests/` | test suite |
| `docs/` | live docs only |

## Current Runtime Paths

| Path | Purpose |
|------|---------|
| `~/Bloom/` | user-facing Bloom state |
| `~/.pi/` | Pi internal state |
| `~/.bloom/pi-bloom` | local repo clone used by repo/dev tools |
| `~/.config/containers/systemd/` | installed Quadlet units |

## Do Not

- keep stale plan/spec archives in the live docs tree
- describe `core/lib/` as purely functional when the current module is host-aware
- document deleted daemon components such as `session-pool.ts` or `room-registry.ts`
- claim a workflow is template- or policy-driven unless the code actually does that today
