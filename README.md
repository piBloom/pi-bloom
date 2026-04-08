# NixPI

NixPI is a VPS-first, headless AI companion OS built on NixOS.

It combines:
- a canonical system checkout at `/srv/nixpi`
- a Zellij-first operator runtime for SSH and local tty sessions
- host automation through NixOS and systemd
- Pi runtime + extensions in one deployable system

By default, interactive operator sessions enter **Zellij** on both SSH and local tty logins. The default layout opens a Pi tab and a plain shell tab. For recovery or troubleshooting, skip auto-start with `NIXPI_NO_ZELLIJ=1` before starting a login shell.

## Quick start

Install onto a fresh OVH VPS from rescue mode:

```bash
nix run .#nixpi-deploy-ovh -- \
  --target-host root@SERVER_IP \
  --disk /dev/sdX
```

After first boot, operate from the canonical checkout:

```bash
cd /srv/nixpi
sudo nixpi-rebuild
sudo nixpi-rebuild-pull
```

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
