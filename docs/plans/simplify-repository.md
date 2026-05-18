# Repository simplification plan

## Goal

Make Nazar easy to understand, operate, and change. Keep one root flake, explicit host/client configs, direct module imports, and service code in obvious places. Avoid generated import trees, thin wrapper layers, and multiple production flake surfaces.

## Chosen model

1. `flake.nix` is the only flake surface.
2. `nix/hosts/<host>/default.nix` is the real host/client composition.
3. `nix/modules/**` holds reusable NixOS modules and host service adapters.
4. `services/**` holds service source, reusable service modules, and package expressions.
5. Root outputs expose stable modules/packages/checks/apps that are useful to consume.

## Implemented structure

```text
flake.nix                       # root inputs, outputs, apps, packages, checks
nix/
  hosts/
    nazar/default.nix           # production host composition
    nazar/hardware-configuration.nix
    nazar/disko.nix
    alex-laptop/default.nix     # client/laptop composition
    alex-laptop/hardware-configuration.nix
  modules/
    host/                       # host baseline, networking, service adapters, monitoring
    guest/                      # shared Pi/default package modules used by host/client
    laptop/                     # client-side access modules
    services/                   # small shared service identity modules
  fleet/
    host.nix
    exposure.nix
    private-domains.nix
    services.nix                # service metadata/context
  packages/pi/
  users/
services/
  dav-server/                   # DAV module source
  minecraft/                    # Minecraft module source
  nixpi/                        # NixPi source, module, and package expression
runbooks/
```

## What changed

- Removed the thin aspect wrapper tree.
- Moved host and laptop composition back into `nix/hosts/*/default.nix`.
- Added `nix/modules/host/minecraft.nix` as the direct Minecraft host adapter.
- Removed service-local flake files; the root flake now exports the useful package, module, dev shell, and checks.
- Renamed service metadata from the old VM-oriented name to `nix/fleet/services.nix`.
- Removed the non-standard `modules.nixos` output to avoid `nix flake check` warning noise.

## Keep

- Root output names for NixOS configs: `nixosConfigurations.nazar`, `nixosConfigurations.alex-laptop`.
- Existing switch app names: `switch-host`, `switch-minecraft`, `switch-dav-server`.
- Private access model for NixPi, Code, and DAV.
- Existing service state directories, ports, users, UID/GID, and `system.stateVersion`.

## Avoid

- No flake-parts, dendrix, den, deploy-rs, treefmt-nix, Home Manager, or other new abstraction libraries in this cleanup.
- No per-service production flakes.
- No generated import trees.
- No large service-code rewrites during the Nix layout cleanup.
- No public exposure changes for private services.

## Validation checklist

```bash
nix fmt
nix flake check --no-build --no-write-lock-file --show-trace
nix eval --raw .#nixosConfigurations.nazar.config.networking.hostName
nix eval --raw .#nixosConfigurations.alex-laptop.config.networking.hostName
nix eval .#nixosConfigurations.nazar.config.services.nixpi-bun.enable
nix eval .#nixosConfigurations.nazar.config.services.openvscode-server.enable
nix eval .#nixosConfigurations.nazar.config.services.radicale.enable
nix eval .#nixosConfigurations.nazar.config.services.minecraft-server.enable
nix build .#nixosConfigurations.nazar.config.system.build.toplevel --no-link
nix build .#nixosConfigurations.alex-laptop.config.system.build.toplevel --no-link
```
