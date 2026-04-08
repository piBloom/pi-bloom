# NixPI

NixPI is a VPS-first, headless AI companion OS built on NixOS.

It combines:
- a final host configuration installed directly by `nixos-anywhere`
- a Zellij-first operator runtime for SSH and local tty sessions
- bootstrap and steady-state host behavior selected in NixOS config
- an optional operator checkout such as `/srv/nixpi` for operator workflows

By default, interactive operator sessions enter **Zellij** on both SSH and local tty logins. The default layout opens a Pi tab and a plain shell tab. For recovery or troubleshooting, skip auto-start with `NIXPI_NO_ZELLIJ=1` before starting a login shell.

## Quick start

Install onto a fresh OVH VPS from rescue mode:

```bash
nix run .#nixpi-deploy-ovh -- \
  --target-host root@SERVER_IP \
  --disk /dev/sdX
```

After install, validate the running host:

```bash
systemctl status sshd.service
systemctl status wireguard-wg0.service
systemctl status nixpi-app-setup.service
```

Operator rebuild path and repo semantics are separate:

- the installed `/etc/nixos` flake is the running host's source of truth
- `sudo nixpi-rebuild` rebuilds that installed host flake from anywhere
- an optional operator checkout such as `/srv/nixpi` is a workspace, not part of install convergence

Optional `/srv/nixpi` sync-and-rebuild helper:

```bash
sudo nixpi-rebuild-pull [branch]
```

The helper syncs a remote branch into the conventional `/srv/nixpi` operator checkout before rebuilding from that checkout.

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
