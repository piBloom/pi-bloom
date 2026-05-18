# Nazar

Declarative dendritic NixOS configuration for the Hetzner host `nazar`, client profile, and host services.

## Scope

This repository owns the host configuration, client access profile, private access model, nginx routing, DAV/NixPi/Code services, Minecraft, operator switch apps, and service code for Nazar. The root flake exposes the production NixOS module surface through `nixosModules` and `modules.nixos`; service subflakes under `services/` may still be used for standalone development, but production composition imports their modules directly from the root repository.

## Services

- Public Minecraft: `mc.nazar.studio` game traffic on `25565/tcp` and voice chat on `24454/udp`.
- Private NixPi: `http://nixpi.nazar.studio/` through sshuttle and host nginx.
- Private Code: `http://code.nazar.studio/` through sshuttle and host nginx.
- Private DAV: `http://dav.nazar.studio/` through sshuttle and host nginx.

## Repository map

```text
nix/aspects/                  # dendritic NixOS aspects and profiles
nix/hosts/                    # generated hardware/disk files and legacy profile entrypoints
nix/modules/                  # existing module bodies wrapped by dendritic aspects
nix/fleet/                    # service and exposure metadata
services/minecraft/           # Minecraft NixOS service module and standalone subflake
services/dav-server/          # DAV/Radicale/WebDAV NixOS module and standalone subflake
services/nixpi/               # NixPi service module/package and standalone subflake
```

## Common commands

```bash
nix flake check
nix fmt
nix run .#switch-host
nix run .#switch-minecraft
nix run .#switch-dav-server
```

## Quick health checks

```bash
systemctl is-active sshd systemd-networkd nginx nixpi-bun openvscode-server radicale minecraft-server
curl -I http://dav.nazar.studio/files/
```

## Policy

- Keep deployment authority in this repository.
- Keep private HTTP services bound to the host private address and reachable through sshuttle.
- Keep service modules reusable, but compose production configuration from the root host flake.
