# dav-server

DAV Server MicroVM service repository for Nazar's private personal info and data service.

This repository owns the DAV service modules used by the canonical Nazar MicroVM fleet. The `/root/nazar` repository remains the fleet orchestrator and owns MicroVM lifecycle, IDs, IP/MAC/DNS/resources, private DNS policy, deploy-rs apps, Git server, and secrets policy.

## Exports

- `nixosModules.dav-server-service` — Radicale/WebDAV service module
- `nixosModules.dav-server-microvm` / `nixosModules.dav-server` / `default` — service-only MicroVM guest module

## Integration contract

Production evaluation is done by `/root/nazar`. Nazar composes this service module with the shared MicroVM guest baseline and `specialArgs` containing `vm`, `fleet`, and `inputs`. This repo defines only MicroVM service modules.

## VM-local Pi workflow

```bash
ssh alex@dav-server
nazar-vm-repo-bootstrap
cd ~/dav-server
pi
nix flake check --no-build
# commit and push to the Git server
nazar-vm-switch
```

Nazar remains the fallback deployment orchestrator:

```bash
cd /root/nazar
nix flake lock --update-input dav-server
nix run .#deploy-dav-server
```
