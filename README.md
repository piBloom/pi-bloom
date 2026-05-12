# nazar

<<<<<<< HEAD
Declarative NixOS + MicroVM configuration for the Hetzner host `nazar`.
=======
This repository is the declarative NixOS fleet/orchestrator for `nazar` and its service VMs.
>>>>>>> ff553ce (Purge legacy Proxmox and NetBird references)

## Current host identity

| Item | Value |
|---|---|
<<<<<<< HEAD
| Host | `nazar` |
| Public IPv4 | `167.235.12.22` |
| OS | NixOS |
| NetBird | `nazar.netbird.cloud` / `100.124.51.27` |
| Daily SSH | `netbird ssh alex@nazar` |
| Public fallback SSH | `ssh alex@167.235.12.22` |

Root SSH is disabled. Hetzner Rescue is the break-glass root path.
=======
| Hostname | `nazar` |
| Public IPv4 | `167.235.12.22` |
| Public IPv6 | `2a01:4f8:262:1b01::2/64` |
| Main NIC | `enp0s31f6` |
| VM network | `nazar0`, `10.10.10.1/24` |
>>>>>>> ff553ce (Purge legacy Proxmox and NetBird references)

## Repository layout

```text
<<<<<<< HEAD
flake.nix                 # Nazar fleet orchestrator and deploy apps
flake.lock                # pinned inputs
nix/fleet/vms.nix         # VM inventory: IDs, IPs, DNS, sizing
nix/modules/host/         # NixOS host modules
nix/modules/common/       # reusable MicroVM guest baseline
nix/modules/services/     # Nazar-owned MicroVM services, including dav
scripts/netbird/          # NetBird policy/DNS reconciliation helpers
runbooks/                 # operational runbooks
security/                 # hardening notes and roadmap
```

## Active services

### Git / Forgejo

| Item | Value |
|---|---|
| MicroVM | `git` |
| IP | `10.10.10.21` |
| Web | `http://git.nazar.studio/` |
| Git SSH | `ssh://git@git.nazar.studio:10022/nazar/<repo>.git` |
| Host proxy | nginx `:80` and socat `:10022` |
=======
flake.nix                 # fleet orchestrator, deploy-rs apps, VM repo inputs
flake.lock                # locks nixpkgs, infra inputs, and VM repo inputs
nix/fleet/vms.nix         # central VM inventory: IDs, IPs, DNS, sizing, service contracts
nix/modules/common/       # reusable VM baseline modules
nix/modules/host/         # host NixOS modules
scripts/                  # operational scripts
systemd/                  # host-side units/timers where still used
www/nazar-dashboard/      # private dashboard assets, if enabled later
runbooks/                 # focused operational procedures and VM runbook stubs
security/                 # focused hardening notes, if needed
```

## VM policy

Default VM rule: new VMs should run NixOS and be fully declarative. Guest OS, packages, services, users, firewall, SSH, and backup hooks should live in version-controlled Nix configuration. Manual guest changes are not a valid long-term state.

Nazar owns the central fleet inventory, shared VM baseline, and infrastructure/networking boundary. Each NixOS VM gets declarative fleet context at `/etc/nazar/vm-context.md`, a generated self-rebuild flake at `/etc/nazar/self`, and helpers `nazar-vm-context`, `nazar-vm-switch`, and `nazar-deploy-request` so VM-local Pi agents can commit, push, and rebuild their own VM without broad fleet credentials.

## Private Git server

| Item | Value |
|---|---|
| VM ID | `101` |
| VM name | `git` |
| Guest OS | NixOS 26.05 pre-release from this flake |
| VM IP | `10.10.10.21` |
| Web UI | `http://git.nazar.studio/` |
| Git SSH remote | `ssh://git@git.nazar.studio:10022/nazar/nazar.git` |
| Access model | Private NAT/host-proxied only |
>>>>>>> ff553ce (Purge legacy Proxmox and NetBird references)

### DAV

<<<<<<< HEAD
Planned fresh personal data VM. No old OwnLoom/OwnLoom Data state is retained.

| Item | Value |
|---|---|
| MicroVM | `dav` |
| IP | `10.10.10.41` |
| DNS | `dav.nazar.studio` |
| Build | `nix build .#dav-qcow2` |
| Deploy | `nix run .#deploy-dav` |
| State | `/persist/microvms/dav` |
| Services | WebDAV `/files/`, CalDAV/CardDAV `/radicale/` |
| Exposure | NetBird/private-only |

See `runbooks/DAV_VM.md`.

### Minecraft

Declared as `minecraft` / `mc.nazar.studio`; restore/deploy separately when ready.

## Agent direction

OwnLoom is removed. Host-level `pi` is being replaced with Hermes Agent.

Target architecture:

1. `nazar` host Hermes: technical architect/operator for infrastructure work.
2. Future personal Hermes MicroVM: life manager with access to `dav`, isolated from host infrastructure authority.
=======
A PaperMC Minecraft VM is declared for the `balaur.org` server.

| Item | Value |
|---|---|
| VM ID | `110` |
| VM name | `minecraft` |
| Guest OS | NixOS 26.05 pre-release from this flake |
| VM IP | `10.10.10.30` |
| Service DNS | `balaur.org` |
| Service ports | `80/tcp` for the landing page, `25565/tcp` for Minecraft, `24454/udp` for Simple Voice Chat |
| State path | `/var/lib/minecraft` |
| Access model | Public landing page plus Minecraft TCP/25565 and voice UDP/24454 forwarding enabled; admin access is SSH-only as `alex` on `nazar` |

## OwnLoom VMs

| VM | IP | Purpose | Access model |
|---|---|---|---|
| `ownloom` | `10.10.10.40` | OwnLoom Pi agent, technical wiki, private web UI, developer terminal | Private/internal only |
| `ownloom-data` | `10.10.10.41` | DAV/Radicale data tier | Private/internal only |
>>>>>>> ff553ce (Purge legacy Proxmox and NetBird references)

Secrets must go through runtime secret files / secret management, never literal Nix values.

<<<<<<< HEAD
## Useful commands

```bash
git status --short --branch
nix flake check --no-build
sudo nix --accept-flake-config build .#nixosConfigurations.nazar.config.system.build.toplevel --print-build-logs
systemctl is-active netbird sshd microvm@git nginx git-ssh-proxy
curl -I http://git.nazar.studio/
git ls-remote ssh://git@git.nazar.studio:10022/nazar/nazar.git
```

## Constraints

- Do not commit secrets.
- Do not expose private services publicly without an explicit hardening decision.
- Do not enable root SSH.
- Destructive Hetzner actions require explicit confirmation and are only for `nazar` / `167.235.12.22`.
=======
Shell access from an admin machine with the declared Alex key:

```bash
ssh alex@167.235.12.22
```

`alex` is a Linux sudo admin on the host. The host `alex` password is locked; shell access is key-only and sudo is passwordless. Root SSH is disabled; use the out-of-band rescue/console path for break-glass recovery.

Inside `nazar`, use VM-name aliases for private NAT access. `alex` is the canonical NixOS VM admin user; VM passwords remain locked and SSH is key-only:

```bash
ssh alex@git
ssh alex@minecraft
ssh alex@ownloom
ssh alex@ownloom-data
```

Direct public SSH to VMs is not canonical; administer VMs from `nazar` over the private NAT aliases.

## Fleet orchestration

Day-2 production VM changes are deployed by `/root/nazar` on the host, using `deploy-rs` over the private VM aliases as `alex` with sudo to the root system profile.

```bash
ssh alex@167.235.12.22
cd /root/nazar
nix flake check --no-build
nix run .#deploy-git
nix run .#deploy-minecraft
nix run .#deploy-ownloom
nix run .#deploy-ownloom-data
NAZAR_DEPLOY_ALL_CONFIRM=yes nix run .#deploy-all
```

After each deploy, run the VM's service checks. These commands switch the NixOS system profile on existing guests; VM lifecycle actions remain separately gated.

## Public exposure rule

Default posture: services are private/internal unless explicitly exposed. Public port forwards remain disabled unless a service is intentionally being shared.

Before toggling any service public, harden that VM/service for public traffic: real auth, TLS/proxying, least-privilege ports, no admin/debug exposure, backups/restore tested, logging/alerting, and a clear rollback toggle. If we are not sharing it yet, leave it private/internal.

## DNS names

```text
Balaur public DNS target:
  balaur.org                     -> 167.235.12.22
```

## Warning about secrets

This repository should not contain private keys, passwords, provider tokens, setup keys, or overlay-network secrets.
>>>>>>> ff553ce (Purge legacy Proxmox and NetBird references)
