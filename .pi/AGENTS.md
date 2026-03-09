# Bloom Project Context (.pi/AGENTS.md)

## Stack

Bloom is a Pi-native OS platform package built with:
- Node.js + TypeScript (ESM, `module: NodeNext`)
- Pi package resources:
  - TypeScript extensions in `extensions/`
  - Markdown skills in `skills/`
- Fedora bootc + Podman + systemd Quadlet service workflows in `os/` and `services/`

No frontend web framework (React/Vue/Next.js) detected.

## Primary Commands

### Build & quality
- `npm run build` — TypeScript build (`tsc --build`)
- `npm run check` — Biome lint/format check across repo
- `npm run check:fix` — Biome autofix

### OS image & VM workflow (Justfile)
- `just build` — Build OS container image from `os/Containerfile`
- `just qcow2` — Generate qcow2 image via bootc-image-builder
- `just iso` — Generate anaconda ISO
- `just vm` / `just vm-serial` — Boot generated qcow2 in QEMU
- `just vm-ssh` — SSH into VM
- `just vm-kill` — Stop running VM
- `just clean` — Remove generated artifacts
- `just deps` — Install host dependencies

### Tests
- `npm test` — Vitest test suite
- `npm run test:coverage` — Vitest with v8 coverage (80% threshold)

## Code Conventions (detected)

From `biome.json`:
- Indentation: tabs (`indentWidth: 2`)
- Line width: 120
- JavaScript/TypeScript quote style: double quotes
- Semicolons: always
- Recommended Biome lint rules enabled

From `tsconfig.json`:
- `strict: true`
- `target: ES2022`
- `module/moduleResolution: NodeNext`
- Output to `dist/`
- Source files: `extensions/**/*.ts`

## Directory Overview

- `extensions/` — Pi extension modules (core product behavior)
- `skills/` — Domain skills (`SKILL.md`) used by Pi
- `services/` — Bundled service packages (lemonade, matrix, element, dufs, examples)
- `os/` — bootc image build assets, sysconfig, output manifests
- `persona/` — OpenPersona identity layers (`SOUL/BODY/FACULTY/SKILL`)
- `docs/` — architecture, protocol, deployment, supply-chain docs
- `dist/` — TypeScript build output
