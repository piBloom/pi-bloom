# NixPI

NixPI is a VPS-first, headless AI companion OS built on NixOS.

It combines:
- a canonical system checkout at `/srv/nixpi`
- a shell-first Pi runtime for SSH sessions
- host automation through NixOS and systemd
- Pi runtime + extensions in one deployable system

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
