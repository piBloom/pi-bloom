# minecraft

Nazar-owned PaperMC Minecraft MicroVM service repository.

This repository owns the Minecraft service modules used by the canonical Nazar MicroVM fleet. The `/root/nazar` repository remains the fleet orchestrator and owns MicroVM lifecycle, IDs, IP/MAC/DNS/resources, host forwarding/firewall policy, deploy-rs apps, and secrets policy.

## Exports

- `nixosModules.minecraft-service` — PaperMC service module
- `nixosModules.minecraft-web` — nginx/static website for `mc.nazar.studio`
- `nixosModules.minecraft-microvm` / `nixosModules.minecraft` / `default` — service-only MicroVM guest module

## Integration contract

Production evaluation is done by `/root/nazar`. Nazar composes this service module with the shared MicroVM guest baseline and `specialArgs` containing `vm`, `fleet`, and `inputs`. This repo defines only MicroVM service modules.

## VM-local Pi workflow

```bash
ssh alex@minecraft
nazar-vm-repo-bootstrap
cd ~/minecraft
pi
nix flake check --no-build
# commit and push to the Git server
nazar-vm-switch
```

Nazar remains the fallback deployment orchestrator:

```bash
cd /root/nazar
nix flake lock --update-input minecraft
nix run .#deploy-minecraft
```
