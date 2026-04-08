# Getting Started

Use this page to orient yourself quickly.

## What NixPI is

NixPI is a headless NixOS system that runs Pi with:
- a terminal-first browser surface backed by ttyd
- a canonical repo at `/srv/nixpi`
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
