# Nazar Minecraft service

Nazar-owned PaperMC Minecraft NixOS service module.

This directory owns the reusable Minecraft module and related service files. The root Nazar flake imports `services/minecraft/nix/modules/minecraft-papermc.nix` through `nix/modules/host/minecraft.nix` and supplies production context from `nix/fleet/services.nix`.

## Root exports

The repository root flake exposes:

- `nixosModules.minecraft` / `nixosModules.minecraft-service` — PaperMC service module.
- `nixosModules.minecraft-web` — optional Minecraft web module.
- `checks.x86_64-linux.minecraft-module-eval` — module evaluation check.

## Production

Production evaluation is done by the Nazar monorepo root. Use:

```bash
nix run .#switch-minecraft
```
