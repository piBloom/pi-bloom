# NixPI

NixPI is a VPS-first, headless AI companion OS built on NixOS.

It combines:
- a plain OVH-compatible NixOS base system
- a host-owned `/etc/nixos` system root
- a shared `nixpi-bootstrap-host` integration path for already-installed NixOS systems
- a plain shell runtime for SSH and local tty sessions

Interactive operator sessions stay in a plain shell by default. Pi remains available as a normal command inside that shell.

## Quick start

Install a plain base system onto a fresh OVH VPS from rescue mode:

```bash
nix run .#nixpi-deploy-ovh -- \
  --target-host root@SERVER_IP \
  --disk /dev/sdX
```

After the machine boots, reconnect to the installed host and bootstrap NixPI on the machine:

```bash
nix run github:alexradunet/nixpi#nixpi-bootstrap-host -- \
  --primary-user alex \
  --ssh-allowed-cidr YOUR_ADMIN_IP/32 \
  --authorized-key-file /root/.ssh/authorized_keys \
  --timezone Europe/Bucharest \
  --keyboard us
```

If you do not pass `--hostname`, the host keeps the default `nixos` hostname.
Bootstrap stays enabled after the first rebuild so SSH remains reachable while you validate the machine and complete the operator handoff.

Validate the running host:

```bash
systemctl status sshd.service
systemctl status nixpi-app-setup.service
systemctl status nixpi-update.timer
sshd -T | grep -E 'passwordauthentication|permitrootlogin|allowtcpforwarding|allowagentforwarding'
sudo nft list ruleset | grep 'dport 22'
```

If the SSH allowlist is wrong, recover through the OVH console or rescue mode. There is no remote VPN fallback.

Steady-state host model:

- `/etc/nixos` is the running host's source of truth
- `sudo nixpi-rebuild` rebuilds the installed `/etc/nixos#nixos` host flake
- NixPI is layered onto the host-owned system configuration rather than replacing the machine root

Rollback if needed:

```bash
sudo nixos-rebuild switch --rollback
```

## Docs

- Documentation site: https://alexradunet.github.io/NixPI
- Install guide: https://alexradunet.github.io/NixPI/install
- Operations: https://alexradunet.github.io/NixPI/operations/
- Architecture: https://alexradunet.github.io/NixPI/architecture/
- Reference: https://alexradunet.github.io/NixPI/reference/
- Internal notes (non-public): `internal/`

Run docs locally:

```bash
npm run docs:dev
```
