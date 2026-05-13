# DAV Server Proxmox VM

Declarative NixOS VM profile for the private personal/user-data DAV tier.

```text
Hostname: dav-server
VMID: 121
NAT IP: 10.10.10.41/24 on vmbr1
Domain metadata: dav.nazar.studio
NetBird: dav-server.netbird.cloud / dav.nazar.studio
Resources: 2 vCPU, 4096 MiB RAM, 100 GiB disk
Autostart: disabled initially
Public exposure: none
```

Enabled scope:

- Radicale CalDAV/CardDAV service on loopback, proxied by nginx at `/radicale/`.
- nginx WebDAV at `/files/` for personal wiki/files/journal Markdown.
- Private-only firewall access on NetBird `wt0`; the NAT bridge remains for shell/admin access from `nazar`, not DAV service exposure.

State paths:

```text
/var/lib/radicale/collections        Radicale calendars, contacts, journals
/var/lib/dav-server/webdav         WebDAV personal files/wiki/journal data
/var/lib/dav-server/webdav/wiki    default personal wiki WebDAV collection
/var/lib/dav-server/wiki-git-backup hourly git snapshot worktree for the personal wiki
```

Auth note: no plaintext credentials or password hashes are committed.
nginx enforces Basic Auth for both `/files/` and `/radicale/` using `/var/lib/dav-server/secrets/dav-server-htpasswd` (provisioned outside git, `root:nginx`, `0640`). Radicale is bound to loopback and uses `http_x_remote_user` from nginx, with `owner_only` rights. For the ultra-simple initial setup, both human and VM 120 wiki-backend access use the `alex` WebDAV user; VM 120 reads its password from `/var/lib/ownloom/secrets/alex-webdav-password` (provisioned outside git). Current NetBird policy allows TCP/80 only from admin peers and from VM 120 (`ownloom`) to this VM; VM SSH remains through `nazar` and the NAT alias. Move these runtime secrets to encrypted sops-managed material and test restore/backups before migrating real personal data.

Personal wiki git backup:

- primary storage remains WebDAV at `/var/lib/dav-server/webdav/wiki`;
- `dav-server-wiki-git-backup.timer` snapshots it hourly;
- snapshots push to private Forgejo repo `nazar/personal-wiki-backup` over the private NAT bridge;
- deploy key lives outside git at `/var/lib/dav-server/secrets/dav-server-wiki-backup-ed25519`.

Validate local module exports from the repository root:

```bash
nix flake show
nix flake check --no-build
```

Production toplevel and qcow2 image builds are run from `/root/nazar` after the
Nazar orchestrator imports this module. This repository exports NixOS modules
only; it does not export production `nixosConfigurations` or image packages.
