# nazar

Declarative NixOS + MicroVM configuration for the Hetzner host `nazar`.

## Current host identity

| Item | Value |
|---|---|
| Hostname | `nazar` |
| Public IPv4 | `167.235.12.22` |
| Public IPv6 | `2a01:4f8:262:1b01::2/64` |
| Main NIC | `enp0s31f6` |
| MicroVM network | `10.10.10.0/24`, host gateway `10.10.10.1` |
| WireGuard | `wg0`, `10.44.0.1/24`, UDP `51820` |

Canonical daily administration and private service access is through WireGuard. Public SSH to `alex@167.235.12.22` remains enabled only as a key-only break-glass path. Root SSH is disabled.

## Canonical access model

Default posture: private by default, WireGuard first.

Canonical paths:

- Daily host SSH: `ssh alex@10.44.0.1` over WireGuard.
- Private Git: `git.nazar.studio` over WireGuard DNS.
- Private DAV Server: `dav.nazar.studio` over WireGuard DNS.
- Public SSH: break-glass only, not the normal path.
- Hetzner Rescue: final recovery path if both WireGuard and public SSH are unusable.

Publicly reachable services are limited to:

- SSH `22/tcp` on `nazar` for break-glass host administration as `alex` only.
- WireGuard `51820/udp` on `nazar`.
- Minecraft game traffic for `balaur.eu` and `balaur.nazar.studio`: `25565/tcp` and Simple Voice Chat `24454/udp` DNAT to the Minecraft MicroVM.

Private WireGuard services:

- `git.nazar.studio` -> `10.44.0.1`, HTTP via host nginx to Forgejo and Git SSH via host socat on `10022/tcp`.
- `dav.nazar.studio` -> `10.44.0.1`, HTTP via host nginx to the DAV Server MicroVM when it is running.
- DNS for WireGuard clients is dnsmasq on `10.44.0.1`, bound to `wg0` only, forwarding other queries upstream.

There is intentionally no public HTTP/TCP/80 DNAT to Minecraft and no public Forgejo or DAV exposure. WireGuard peers are network-trusted; sensitive services such as DAV still need service-level auth before broad client onboarding.

## Repository layout

```text
flake.nix                 # fleet orchestrator, deploy-rs apps, VM image composition
flake.lock                # pinned inputs
nix/fleet/vms.nix         # VM inventory: IDs, IPs, DNS, sizing, service contracts
nix/modules/host/         # host NixOS modules, including WireGuard/firewall/proxies
nix/modules/common/       # reusable MicroVM guest baseline
nix/modules/services/     # thin integration wrappers for external VM services
runbooks/                 # operational runbooks
```

## Active/declarative services

| Service | VM | Private/Public endpoint | Notes |
|---|---|---|---|
| Forgejo | `git` / `10.10.10.21` | `git.nazar.studio` on WireGuard (`10.44.0.1`) | HTTP `80`, Git SSH `10022` via host proxy; autostarted |
| Minecraft | `minecraft` / `10.10.10.30` | `balaur.eu`, `balaur.nazar.studio`; public game `25565/tcp`, voice `24454/udp` | no public webapp |
| DAV Server | `dav-server` / `10.10.10.41` | `dav.nazar.studio` on WireGuard (`10.44.0.1`) | WebDAV `/files/`, CalDAV/CardDAV `/radicale/`; start/deploy deliberately |

## DNS intent

Public DNS should publish only names that are intentionally public, currently the Minecraft game names `balaur.eu` and `balaur.nazar.studio` pointing at `167.235.12.22`. Private service names such as `git.nazar.studio` and `dav.nazar.studio` should not have public A/AAAA records; WireGuard clients resolve them through dnsmasq on `10.44.0.1`.

## Fleet orchestration

Day-2 production VM changes are deployed by `/root/nazar` on the host, using `deploy-rs` over the private VM aliases as `alex` with sudo to the root system profile.

```bash
ssh alex@10.44.0.1  # canonical, over WireGuard
# or, for break-glass only: ssh alex@167.235.12.22
cd /root/nazar
nix flake check --no-build
nix run .#deploy-git
nix run .#deploy-minecraft
nix run .#deploy-dav-server
NAZAR_DEPLOY_ALL_CONFIRM=yes nix run .#deploy-all
```

After each deploy, run the VM's service checks. These commands switch the NixOS system profile on existing guests; VM lifecycle actions remain separately gated.

## Useful commands

```bash
git status --short --branch
nix fmt
nix flake check --no-build
sudo nix --accept-flake-config build .#nixosConfigurations.nazar.config.system.build.toplevel --print-build-logs
systemctl is-active sshd wireguard-wg0 dnsmasq nginx git-ssh-proxy microvm@git
sudo wg show wg0
```

From a configured WireGuard client:

```bash
dig @10.44.0.1 git.nazar.studio +short
dig @10.44.0.1 dav.nazar.studio +short
curl -I http://git.nazar.studio/
git ls-remote ssh://git@git.nazar.studio:10022/nazar/nazar.git
```

## Constraints

- Do not commit secrets or WireGuard private keys.
- Add only client public keys and assigned `/32` WireGuard addresses to Nix.
- Do not expose private services publicly without an explicit hardening decision.
- Treat WireGuard as the canonical daily access path.
- Keep public SSH key-only and alex-only as break-glass until a separate migration decision and rescue drill.
- Do not enable root SSH.
