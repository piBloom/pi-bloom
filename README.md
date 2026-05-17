# nazar

Declarative NixOS configuration for the Hetzner host `nazar` and its small MicroVM service fleet.

## Purpose

This repository owns the host configuration, private access model, nginx routing, MicroVM composition, and operator switch apps for Nazar. Service code is supplied by small service flakes such as `minecraft` and `dav-server`; the running host remains the deployment authority.

## Current access model

Default posture: private by default, sshuttle first.

- Private operator tunnel: `nazar-sshuttle.service` from configured laptops over public SSH to `alex@167.235.12.22`.
- Private service address: `10.44.0.1/32` on the host-local `nazar-private` interface.
- Daily host SSH: `ssh alex@10.44.0.1` through sshuttle.
- Public host SSH: `22/tcp`, key-only, `alex` only, for administration and sshuttle.
- Public HTTP: `http://nazar.studio/`, static dashboard only.
- Public Minecraft: `mc.nazar.studio` game traffic, `25565/tcp` and `24454/udp`, DNAT to the Minecraft MicroVM.
- Private Git: `git.nazar.studio` through sshuttle, SSH on the host's standard `22/tcp`.
- Private NixPi: `http://nixpi.nazar.studio/` through sshuttle and host nginx.
- Private DAV: `http://dav.nazar.studio/` through sshuttle and host nginx to the DAV MicroVM.

There is intentionally no public Git, DAV, or NixPi exposure.

## Active services

| Service        | Runs on                              | Endpoint                                   | Notes                                                              |
| -------------- | ------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------ |
| Host dashboard | host `nazar`                         | `http://nazar.studio/`                     | public static site                                                 |
| Git            | host `nazar`                         | `git.nazar.studio` over sshuttle           | SSH-only bare repos owned by `alex`                                |
| NixPi          | host `nazar`                         | `http://nixpi.nazar.studio/` over sshuttle | Flake-packaged Bun service; Pi RPC workspace UI                    |
| Minecraft      | MicroVM `minecraft` / `10.10.10.30`  | `mc.nazar.studio:25565`, voice `24454/udp` | public game service                                                |
| DAV Server     | MicroVM `dav-server` / `10.10.10.41` | `http://dav.nazar.studio/` over sshuttle   | WebDAV, CalDAV, CardDAV, private data service                      |

## Repository layout

```text
flake.nix                    # host/laptop configurations and switch apps
nix/fleet/host.nix           # shared host identity constants
nix/fleet/private-domains.nix # generated private domain list for host/laptop hosts files
nix/fleet/vms.nix            # active MicroVM inventory and service data
nix/fleet/exposure.nix       # host HTTP route policy
nix/hosts/                   # host and laptop entrypoints
nix/modules/host/            # host networking, firewall, nginx, Git, NixPi, MicroVM host
nix/modules/guest/           # reusable MicroVM guest baseline
nix/modules/services/        # thin service identity wrappers
nix/users/                   # public SSH key material only
runbooks/                    # operational runbooks
www/                         # static public dashboard
```

## Switch commands

Run host-driven switches from `/root/nazar` on the host:

```bash
cd /root/nazar
nix flake check --no-build
nix run .#switch-host
nix run .#switch-minecraft
nix run .#switch-dav-server
nix run .#switch-fleet
```

For service repo updates, update the corresponding flake input first, then run the service switch app:

```bash
nix flake lock --update-input minecraft
nix run .#switch-minecraft

nix flake lock --update-input dav-server
nix run .#switch-dav-server

nix flake lock --update-input nixpi
nix run .#switch-host
```

`switch-minecraft` and `switch-dav-server` switch the host configuration and restart the selected MicroVM. `switch-fleet` switches the host and restarts all active MicroVMs.

## Validation commands

```bash
nix flake check --no-build
nix --accept-flake-config build .#nixosConfigurations.nazar.config.system.build.toplevel --no-link --print-build-logs
nix eval --json .#nixosConfigurations.alex-laptop.config.nazar.access.sshuttle.privateDomains
systemctl is-active sshd systemd-networkd nginx nixpi-bun
systemctl is-active microvm@minecraft.service microvm@dav-server.service
ip addr show nazar-private
```

From a configured sshuttle laptop:

```bash
systemctl status nazar-sshuttle
getent hosts nazar.studio nixpi.nazar.studio dav.nazar.studio git.nazar.studio
curl -I http://nazar.studio/
curl -I http://nixpi.nazar.studio/
git ls-remote ssh://alex@git.nazar.studio/nazar/nazar.git
```

## Constraints

- Do not commit secrets or private SSH keys.
- Add only trusted client public SSH keys to `nix/users/alex-public-ssh-keys.nix`.
- Keep root SSH disabled.
- Keep public SSH key-only and `alex`-only because it is the sshuttle control endpoint.
- Keep Git, DAV, and NixPi private unless there is an explicit hardening decision.
- Treat sshuttle over OpenSSH as the canonical private access path.
- The host owns MicroVM lifecycle; service repos export service modules and do not own deployment.
- Use the host-built `switch-*` apps for MicroVM changes; do not add a second guest-local deployment path without an explicit architecture decision.
- Avoid new deploy frameworks or route abstractions while the fleet remains one host and two active MicroVMs.
