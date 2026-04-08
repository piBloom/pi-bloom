# Getting Started

Use this page to orient yourself quickly.

## What NixPI is

NixPI is a headless NixOS system that runs Pi with:
- a shell-first operator workflow over SSH or a local terminal
- the installed `/etc/nixos` flake as the running host source of truth
- an optional operator checkout such as `/srv/nixpi` for repo-backed rebuild workflows
- host operations through `nixos-rebuild` and systemd

## Read in this order

1. [Install](../install)
2. [Quick Deploy](../operations/quick-deploy)
3. [First Boot Setup](../operations/first-boot-setup)
4. [Architecture](../architecture/)
5. [Reference](../reference/)

## Core commands

```bash
# Tests
npm run test

# Build
npm run build

# Docs
npm run docs:dev
npm run docs:build

# Rebuild on host
sudo nixpi-rebuild
```
