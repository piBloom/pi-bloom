# NixPI

NixPI is a VPS-first, headless AI companion OS built on NixOS.

It combines:
- a canonical system checkout at `/srv/nixpi`
- a browser-accessible Pi terminal surface backed by ttyd
- host automation through NixOS and systemd
- Pi runtime + extensions in one deployable system

## Quick start

Run on a fresh NixOS-capable VPS:

```bash
nix --extra-experimental-features 'nix-command flakes' run github:alexradunet/nixpi#nixpi-bootstrap-vps
```

Then operate from the canonical checkout:

```bash
cd /srv/nixpi
git status
sudo nixpi-rebuild
```

To update the canonical checkout and rebuild in one step:

```bash
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
- Manual QEMU lab: `tools/qemu/README.md`
- Internal notes (non-public): `internal/`

Run docs locally:

```bash
npm run docs:dev
```
