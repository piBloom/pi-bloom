# Dendritic NixOS refactor plan

## Approved direction

- No new libraries or flake inputs for the pattern: no flake-parts, dendrix, den, or import-tree.
- Keep one root flake surface. The root flake exposes repo modules as `nixosModules` and `modules.nixos`.
- Production composition imports service module files directly from `services/*/nix/modules/*.nix`; local service subflakes may remain for standalone service development.
- Use plain feature paths under `nix/aspects/` to avoid shell/path quoting issues, for example `services/minecraft`.
- Treat `alex-laptop` as a client profile in the same dendritic tree.

## Implemented target shape

```text
flake.nix                         # root inputs, nixosModules/modules.nixos surface, configs/apps/packages
nix/aspects/                      # dendritic aspects and profiles
  profiles/host-production/       # production Nazar host closure
  profiles/client-alex-laptop/    # laptop/client closure
  access/*/                       # SSH, private HTTP, sshuttle client aspects
  agents/*/                       # Pi/LLM agent aspects
  networking/*/                   # host uplink/firewall/proxy aspects
  services/*/                     # host service aspects wrapping service modules
  system/*/                       # base system aspects
nix/hosts/                        # generated hardware/disko and compatibility profile entrypoints
nix/modules/                      # existing NixOS module bodies wrapped by aspects
services/*                        # standalone service development flakes/modules
```

The inversion is now: profiles select feature aspects, aspects wrap service/system module bodies, and the root flake publishes the named module surface.

## Validation checklist

```bash
nix fmt
nix flake check
nix eval .#nixosConfigurations.nazar.config.networking.hostName
nix eval .#nixosConfigurations.alex-laptop.config.networking.hostName
```

Before switching the production host:

```bash
nix build .#nixosConfigurations.nazar.config.system.build.toplevel
nix run .#switch-host -- --dry-run
```

## Follow-up opportunities

- Gradually move logic from `nix/modules/` wrappers into the aspect directories once the new surface has baked.
- Add typed `nazar.*` options for feature-specific defaults only where reuse justifies it.
- Decide whether standalone service subflakes should also expose the same root module names for development parity.
