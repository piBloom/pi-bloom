# nazar

Declarative NixOS + MicroVM configuration for the Hetzner host `nazar`.

## Current host identity

| Item                    | Value                                                        |
| ----------------------- | ------------------------------------------------------------ |
| Hostname                | `nazar`                                                      |
| Public IPv4             | `167.235.12.22`                                              |
| Public IPv6             | `2a01:4f8:262:1b01::2/64`                                    |
| Main NIC                | `enp0s31f6`                                                  |
| MicroVM network         | `10.10.10.0/24`, host gateway `10.10.10.1`                   |
| Private service address | `10.44.0.1/32` on host-local dummy interface `nazar-private` |

Canonical private administration and private service access is through `sshuttle` over hardened public SSH to `alex@167.235.12.22`. Root SSH is disabled.

## Canonical access model

Default posture: private by default, sshuttle first.

Canonical paths from a configured laptop:

- Private tunnel: `nazar-sshuttle.service`, using `sshuttle` over `nazar-sshuttle` SSH host alias.
- Daily host SSH: `ssh alex@10.44.0.1` through sshuttle.
- Public main page: `http://nazar.studio/`, served by host nginx.
- Private host NixPi: `http://nazar.studio/nixpi/` through sshuttle.
- Private DAV Server: `dav.nazar.studio` through sshuttle and declarative `/etc/hosts` entries.
- Private per-service NixPi: `/nixpi/` on service domains such as `mc.nazar.studio` and `dav.nazar.studio`.
- Private Git: `git.nazar.studio` through sshuttle; Git remains an infrastructure service managed from the Nazar repo and Pi/subagent workflows.
- Hetzner Rescue: final recovery path if SSH is unusable.

Publicly reachable services are limited to:

- SSH `22/tcp` on `nazar` for the sshuttle control connection and key-only host administration as `alex` only.
- HTTP `80/tcp` for the simple static `nazar.studio` page only.
- Minecraft game traffic for `mc.nazar.studio`: `25565/tcp` and Simple Voice Chat `24454/udp` DNAT to the Minecraft MicroVM.

Private sshuttle services:

- `nazar.studio/nixpi/` -> `10.44.0.1`, HTTP via host nginx to the host-local NixPi service.
- `git.nazar.studio` -> `10.44.0.1`, SSH-only Git via host sshd on port `22/tcp`.
- `mc.nazar.studio/nixpi/` -> `10.44.0.1`, HTTP via host nginx to the Minecraft VM-local NixPi service.
- `dav.nazar.studio` -> `10.44.0.1`, HTTP via host nginx to the DAV Server MicroVM when it is running.
- `dav.nazar.studio/nixpi/` -> `10.44.0.1`, HTTP via host nginx to the DAV Server VM-local NixPi service.

There is intentionally no public HTTP/TCP/80 DNAT to Minecraft and no public Git, DAV, or NixPi exposure.

## Repository layout

```text
flake.nix                 # fleet orchestrator, simple switch apps, MicroVM composition
flake.lock                # pinned inputs
nix/fleet/vms.nix         # VM inventory: IDs, IPs, DNS, sizing, service contracts
nix/fleet/exposure.nix    # private/public HTTP exposure policy
nix/modules/host/         # host NixOS modules, including private access/firewall/proxies
nix/modules/common/       # reusable MicroVM guest baseline
nix/modules/services/     # thin integration wrappers for external VM services
runbooks/                 # operational runbooks
```

## Active/declarative services

| Service    | VM                           | Private/Public endpoint                                                          | Notes                                                                                            |
| ---------- | ---------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Git        | host `nazar`                 | `git.nazar.studio` on sshuttle-routed `10.44.0.1`                                | SSH-only bare Git on host; no web UI; no separate VM                                             |
| Minecraft  | `minecraft` / `10.10.10.30`  | `mc.nazar.studio`; public game `25565/tcp`, voice `24454/udp`; private `/nixpi/` | no public webapp                                                                                 |
| DAV Server | `dav-server` / `10.10.10.41` | `dav.nazar.studio` on sshuttle-routed `10.44.0.1`                                | WebDAV `/files/`, CalDAV/CardDAV `/radicale/`; autostarted                                       |
| NixPi      | host + every MicroVM         | `/nixpi/` on the host and per-service domains                                    | private web interface for Pi RPC sessions; route exposure controlled by `nix/fleet/exposure.nix` |

## DNS intent

Configured laptops receive declarative `/etc/hosts` entries mapping private/operator hostnames to `10.44.0.1`, then sshuttle routes that address over SSH. Public DNS should publish only names that are intentionally public: `nazar.studio` for the static page and `mc.nazar.studio` for Minecraft, both pointing at `167.235.12.22`. NixPi remains private even when it shares a public service hostname; public nginx only serves the static `nazar.studio` page.

## Fleet orchestration

Day-2 production VM changes are applied from `/root/nazar` on the host with plain `nixos-rebuild switch` plus MicroVM restarts.

```bash
ssh alex@10.44.0.1  # canonical, through sshuttle from a configured laptop
# or direct control endpoint when needed: ssh alex@167.235.12.22
cd /root/nazar
nix flake check --no-build
nix run .#switch-minecraft
nix run .#switch-dav-server
nix run .#switch-fleet
```

After each switch, run the VM's service checks. These commands switch the host NixOS profile and restart existing MicroVM guests; lifecycle actions remain separately gated. See `runbooks/GIT_SERVER.md` for host Git operations.

## Useful commands

```bash
git status --short --branch
nix fmt
nix flake check --no-build
sudo nix --accept-flake-config build .#nixosConfigurations.nazar.config.system.build.toplevel --print-build-logs
systemctl is-active sshd systemd-networkd nginx nixpi nazar-git-authorized-keys.timer
ip addr show nazar-private
```

From a configured sshuttle laptop:

```bash
systemctl status nazar-sshuttle
getent hosts nazar.studio mc.nazar.studio dav.nazar.studio git.nazar.studio
curl -I http://nazar.studio/
curl -I http://nazar.studio/nixpi/
curl -I http://mc.nazar.studio/nixpi/
curl -I http://dav.nazar.studio/nixpi/
git ls-remote ssh://alex@git.nazar.studio/nazar/nazar.git
```

## Constraints

- Do not commit secrets or private SSH keys.
- Add only trusted client public SSH keys to `nix/users/alex-public-ssh-keys.nix`.
- Do not expose private services, including NixPi, publicly without an explicit hardening decision.
- Treat sshuttle over OpenSSH as the canonical private access path.
- Canonical runtime is MicroVM only; do not add alternate VM targets.
- Enforce one-way host management: `nazar` must be able to SSH to every MicroVM over its private VM hostname/IP, and MicroVMs must not be able to open new connections back to `nazar`.
- Keep public SSH key-only and alex-only because it is the sshuttle control endpoint.
- Do not enable root SSH.
