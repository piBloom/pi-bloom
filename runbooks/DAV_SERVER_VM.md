# DAV Server VM Runbook

VM 121 (`dav-server`) is the approved private personal/user-data DAV VM.

## Target

```text
Hostname / Proxmox name: dav-server
VMID: 121
NAT IP: 10.10.10.41/24 via vmbr1
Gateway: 10.10.10.1
Domain metadata: dav.nazar.studio
NetBird name: dav-server.netbird.cloud
NetBird private DNS: dav.nazar.studio
CPU: 2 vCPU
RAM: 4096 MiB, balloon 1024 MiB
Disk: 100 GiB after Proxmox resize
Firmware for imported image: SeaBIOS
Autostart: off initially
Public exposure: none
NetBird: dav-server.netbird.cloud / 100.124.7.246
Deployment status: running, imported from qcow2, NetBird enrolled
```

NetBird/private access is canonical. Do not add public DNS routes, public port
forwards, or Proxmox host forwarding for this VM without a new explicit decision.
Minecraft remains the only documented opt-in public-service exception.

Direct DAV service access is allowed only by NetBird policy:

```text
admins-to-dav-server-dav: admins -> dav-server TCP/80
ownloom-to-dav-server-dav: ownloom -> dav-server TCP/80
```

VM SSH administration remains through `netbird ssh root@nazar`, then `ssh alex@dav-server` over the private NAT bridge alias. Root VM SSH remains key-only for break-glass and current compatibility.

## Enabled services

- Radicale CalDAV/CardDAV service, suitable for calendar/contact/journal DAV data.
- nginx WebDAV for personal wiki/files/journal Markdown under `/files/`.
- Radicale and WebDAV are reachable through the NetBird interface only; the NAT bridge is not opened for DAV HTTP.

Auth is enabled without committing plaintext credentials or password hashes.
nginx protects both `/files/` and `/radicale/` with Basic Auth from:

```text
/var/lib/dav-server/secrets/dav-server-htpasswd
```

The file is provisioned outside git and should be `root:nginx` / `0640`.
Radicale is bound to loopback and trusts nginx's `X-Remote-User` header via
`auth.type = http_x_remote_user`, with `owner_only` rights. VM 120 uses the
same `alex` WebDAV user for the ultra-simple initial setup and reads its password from:

```text
/var/lib/ownloom/secrets/alex-webdav-password
```

Current plaintext recovery copy on `nazar`, if still present after provisioning:

```text
/root/dav-server-credentials.txt
```

Store those credentials in the password manager and then remove the recovery
copy if desired. Move these runtime secrets to encrypted sops-managed material
and complete backup/restore validation before migrating real personal data.

## State paths

```text
/var/lib/radicale/collections        Radicale collections
/var/lib/dav-server/webdav         WebDAV personal files/wiki/journal data
/var/lib/dav-server/webdav/wiki    default personal wiki collection
/var/lib/dav-server/wiki-git-backup periodic git snapshot worktree for the wiki
```

## Personal wiki git snapshots

The personal wiki remains WebDAV-primary at:

```text
/var/lib/dav-server/webdav/wiki
```

A declarative systemd timer snapshots that directory to the private Forgejo repo:

```text
ssh://git@10.10.10.21:10022/nazar/personal-wiki-backup.git
```

Timer/unit:

```text
dav-server-wiki-git-backup.timer    # hourly, persistent
dav-server-wiki-git-backup.service
```

Runtime deploy key, provisioned outside git:

```text
/var/lib/dav-server/secrets/dav-server-wiki-backup-ed25519
```

The public half is installed as a write deploy key on the private Forgejo repo. The one-time Forgejo bootstrap token used to create the repo/key was deleted after use.

## Validate local module exports

```bash
nix flake show
nix flake check --no-build
```

Production toplevel and qcow2 image builds are run from `/root/nazar` after the
Nazar orchestrator imports this module. This repository exports NixOS modules
only; it does not export production `nixosConfigurations` or repository-local
qcow2 image packages.

## STOP before destructive operations

Do not run destructive Proxmox commands until the user gives explicit live
confirmation. Destructive commands include `qm stop`, `qm destroy`, disk
replacement, and any operation that overwrites an existing VM.

## Create VM 121 from qcow2

Current status: VM 121 has already been created and started. Keep these commands as the recreate procedure. After final confirmation only. Set `IMAGE` to the qcow2 produced by the Nazar orchestrator build:

```bash
IMAGE=/path/to/nazar-built/nixos-dav-server.qcow2

qm create 121 \
  --name dav-server \
  --memory 4096 \
  --balloon 1024 \
  --cores 2 \
  --cpu host \
  --numa 1 \
  --machine q35 \
  --bios seabios \
  --ostype l26 \
  --scsihw virtio-scsi-single \
  --agent enabled=1 \
  --serial0 socket \
  --vga std \
  --tablet 1 \
  --net0 virtio=BC:24:11:0A:4B:21,bridge=vmbr1

qm importdisk 121 "$IMAGE" local --format qcow2
qm set 121 --virtio0 local:121/vm-121-disk-0.qcow2,discard=on
qm set 121 --boot 'order=virtio0'
qm resize 121 virtio0 100G
qm set 121 --onboot 0
qm set 121 --startup order=41
qm start 121
```

No public port-forward validation should exist for this VM because it is internal-only.

## Guest validation

```bash
qm status 121
qm agent 121 ping
ping -c3 10.10.10.41
# From nazar after `netbird ssh root@nazar`:
ssh alex@dav-server 'hostname; whoami; systemctl is-active radicale nginx'
ssh alex@dav-server 'netbird status'
ssh alex@dav-server 'sudo systemctl --failed'
ssh alex@dav-server 'systemctl status radicale nginx --no-pager'
ssh alex@dav-server 'curl -fsS http://127.0.0.1:5232/.web/ >/dev/null || true'
ssh alex@dav-server 'curl -fsS http://127.0.0.1/ | head'
ssh alex@dav-server 'curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1/files/'
ssh alex@dav-server 'systemctl status dav-server-wiki-git-backup.timer --no-pager'
ssh alex@dav-server 'sudo systemctl start dav-server-wiki-git-backup.service'
ssh alex@dav-server 'sudo env GIT_SSH_COMMAND="ssh -i /var/lib/dav-server/secrets/dav-server-wiki-backup-ed25519 -o IdentitiesOnly=yes -o UserKnownHostsFile=/var/lib/dav-server/secrets/dav-server-wiki-backup-known_hosts" git ls-remote ssh://git@10.10.10.21:10022/nazar/personal-wiki-backup.git refs/heads/main'

# From VM 120 (`ownloom`) or an admin peer in the NetBird admins group:
getent hosts dav.nazar.studio
curl -fsS http://dav.nazar.studio/ | head
curl -sS -o /dev/null -w '%{http_code}\n' http://dav.nazar.studio/files/  # expected: 401 without credentials
# Avoid echoing the password or putting it in process arguments.
NETRC=$(mktemp)
trap 'rm -f "$NETRC"' EXIT
chmod 600 "$NETRC"
{
  printf 'machine dav.nazar.studio login alex password '
  sed -n '1p' /var/lib/ownloom/secrets/alex-webdav-password
} > "$NETRC"
curl --netrc-file "$NETRC" \
  -fsS -X OPTIONS -i http://dav.nazar.studio/files/ | head
rm -f "$NETRC"
trap - EXIT

# NAT fallback from Proxmox/private side using key-only root break-glass:
ssh root@10.10.10.41 hostname
```

## VM 122 reservation

`dav-vault` is reserved as a future concept at VMID 122 / `10.10.10.42`.
No Bitwarden/Vaultwarden service is enabled in this repository.
