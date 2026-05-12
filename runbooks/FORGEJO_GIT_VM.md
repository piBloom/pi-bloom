# Forgejo Git MicroVM Runbook

This runbook documents the current Forgejo service after the Proxmox-to-NixOS migration. Forgejo now runs as a `microvm.nix` guest on the bare-metal NixOS host `nazar`.

## Current state

```text
Host:             nazar
Guest name:       git
Runtime:          microvm.nix / QEMU
Service:          Forgejo 15.0.1 LTS
Guest IP:         10.10.10.21/32 via host TAP vm101
State path host:  /persist/microvms/git/forgejo
State path guest: /var/lib/forgejo
Web in guest:     http://10.10.10.21:3000/
Web via NetBird:  http://git.nazar.studio/
Git SSH in guest: 10.10.10.21:10022
Git SSH proxy:    ssh://git@git.nazar.studio:10022/nazar/<repo>.git
```

The host exposes Forgejo only on the NetBird/private side:

```text
NetBird DNS: git.nazar.studio -> nazar NetBird IP
Host nginx:  git.nazar.studio:80 -> 10.10.10.21:3000
Host socat:  :10022 -> 10.10.10.21:10022
```

Public Internet exposure is not enabled for Forgejo.

## Declarative source

Relevant host files:

```text
nix/fleet/vms.nix                       # git VM IP, ports, shares, resources
nix/modules/host/microvm-host.nix       # declares MicroVMs and autostarts git
nix/modules/host/microvm-guest.nix      # common routed TAP guest networking
nix/modules/host/forgejo-proxy.nix      # host nginx + Git SSH proxy
nix/modules/host/firewall.nix           # wt0 allows 80/443/10022
```

Relevant Forgejo service repo files:

```text
../forgejo/nix/modules/forgejo.nix
../forgejo/nix/modules/forgejo-bootstrap.nix
```

## Operations

Start/stop/status from `nazar`:

```bash
sudo systemctl status microvm@git.service --no-pager
sudo systemctl restart microvm@git.service
sudo systemctl status nginx.service git-ssh-proxy.service --no-pager
```

Inspect from the host:

```bash
ip route | grep 10.10.10.21
curl --noproxy '*' -I http://10.10.10.21:3000/
curl --noproxy '*' -I -H 'Host: git.nazar.studio' http://127.0.0.1/
```

Inspect from a NetBird admin client:

```bash
curl --connect-timeout 5 -I http://git.nazar.studio/
git ls-remote ssh://git@git.nazar.studio:10022/nazar/nazar.git
```

SSH into the guest through the host jump path:

```bash
ssh -J alex@167.235.12.22 alex@10.10.10.21
```

## Bootstrap performed after migration

A fresh Forgejo application state was initialized. The old Gogs/Proxmox app database was not preserved.

Created user:

```text
username: nazar
email:    admin@nazar.studio
admin:    yes
```

Created private repositories:

```text
nazar/nazar
nazar/forgejo
nazar/minecraft
nazar/ownloom
nazar/ownloom-data
```

Added the `alex@yoga` SSH public key to the Forgejo user `nazar` for Git SSH pushes.

The generated Forgejo admin password and bootstrap token are stored only on the git guest under:

```text
/var/lib/nazar/secrets/forgejo-admin-password
/var/lib/nazar/secrets/forgejo-bootstrap-token
```

Treat these as secrets. Rotate/delete the bootstrap token after it is no longer needed.

## Push/update repositories

From a local checkout:

```bash
git remote set-url origin ssh://git@git.nazar.studio:10022/nazar/nazar.git
git push origin main
```

Service repos use the same pattern:

```bash
git remote set-url origin ssh://git@git.nazar.studio:10022/nazar/forgejo.git
git remote set-url origin ssh://git@git.nazar.studio:10022/nazar/minecraft.git
git remote set-url origin ssh://git@git.nazar.studio:10022/nazar/ownloom.git
git remote set-url origin ssh://git@git.nazar.studio:10022/nazar/ownloom-data.git
```

If the SSH host key changes after a rebuild:

```bash
ssh-keygen -R '[git.nazar.studio]:10022'
GIT_SSH_COMMAND='ssh -o StrictHostKeyChecking=accept-new' \
  git ls-remote ssh://git@git.nazar.studio:10022/nazar/nazar.git
```

## Validation checklist

```bash
ssh alex@nazar.studio 'hostname'
ssh -J alex@167.235.12.22 alex@10.10.10.21 'systemctl is-active forgejo'
curl -I http://git.nazar.studio/
git ls-remote ssh://git@git.nazar.studio:10022/nazar/nazar.git
```

Expected:

```text
microvm@git.service active
forgejo active
nginx active
git-ssh-proxy active
HTTP 200 from git.nazar.studio
all five repos visible over Git SSH
```

## Recovery notes

Forgejo state is in `/persist/microvms/git/forgejo`. Back this directory up with the host backup strategy.

The host can be rebuilt from the local flake using path inputs while Forgejo is unavailable. Once Forgejo is up, the repos under `nazar/*` become the canonical remote copies.
