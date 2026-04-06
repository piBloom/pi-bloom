# Getting Started

Use this page to orient yourself quickly.

## What NixPI is

NixPI is a headless NixOS system that runs Pi with:
- a remote web app (chat + terminal)
- a canonical repo at `/srv/nixpi`
- host operations through `nixos-rebuild` and systemd

## Read in this order

1. [Install](../install)
2. [Operations](../operations/)
3. [Architecture](../architecture/)
4. [Codebase Guide](../codebase/)
5. [Reference](../reference/)

## Core commands

```bash
# Tests
npm run test

# Build
npm run build

# Docs
npm run docs:dev

# Rebuild on host
sudo nixos-rebuild switch --flake /etc/nixos --impure
```
