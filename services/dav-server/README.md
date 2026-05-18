# Nazar DAV service

Reusable NixOS module for the Nazar DAV service: nginx WebDAV plus Radicale.

This directory owns the service module. The root Nazar flake imports `services/dav-server/nix/modules/dav-server.nix` through `nix/modules/host/dav-server.nix` for production.

## Root exports

The repository root flake exposes:

- `nixosModules.dav-server` / `nixosModules.dav-server-service` — DAV service module.
- `checks.x86_64-linux.dav-server-module-eval` — module evaluation check.

## Production

Production evaluation is done by the Nazar monorepo root. Use:

```bash
nix run .#switch-dav-server
```
