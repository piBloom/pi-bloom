# Nazar

Declarative NixOS configuration for the Hetzner host `nazar`, a client laptop profile, host services, and service source code.

## Scope

This repository has one production Nix surface: the root `flake.nix`. The host and laptop configurations import modules directly from `nix/modules`, while service source and reusable service modules live under `services/`.

The root flake owns deployment, private access policy, nginx routing, DAV/NixPi/Code services, Minecraft, operator switch apps, and the Pi package.

## Services

- Public Minecraft: `mc.nazar.studio` game traffic on `25565/tcp` and voice chat on `24454/udp`.
- Private NixPi: `http://nixpi.nazar.studio/` through sshuttle and host nginx.
- Private Code: `http://code.nazar.studio/` through sshuttle and host nginx.
- Private DAV: `http://dav.nazar.studio/` through sshuttle and host nginx.

## Repository map

```text
flake.nix                     # root flake: configs, modules, packages, checks, apps
nix/hosts/nazar/              # production host composition, hardware, and disk layout
nix/hosts/alex-laptop/        # client/laptop composition and hardware config
nix/modules/host/             # host baseline, networking, service adapters, monitoring
nix/modules/laptop/           # client-side access modules
nix/modules/guest/            # shared Pi/default package modules used by host/client
nix/modules/services/         # small shared service identity modules
nix/fleet/                    # host identity, exposure policy, service metadata
services/minecraft/           # Minecraft source and reusable NixOS module
services/dav-server/          # DAV/Radicale/WebDAV reusable NixOS module
services/nixpi/               # NixPi source, module, and package expression
runbooks/                     # operational notes
```

## Common commands

```bash
nix flake check
nix fmt
nix run .#switch-host
nix run .#switch-minecraft
nix run .#switch-dav-server
```

## Development commands

```bash
nix build .#pi
nix build .#nixpi-bun
nix develop .#nixpi
```

## Quick health checks

```bash
systemctl is-active sshd systemd-networkd nginx nixpi-bun openvscode-server radicale minecraft-server
curl -I http://dav.nazar.studio/files/
```

## Policy

- Keep deployment authority in the root flake.
- Keep private HTTP services bound to the host private address and reachable through sshuttle.
- Keep service code in `services/`, but compose production from the root host configuration.
- Prefer explicit direct imports over generated module discovery or wrapper layers.
