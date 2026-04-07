# NixPI

NixPI is a VPS-first, headless AI companion OS built on NixOS.

It combines:
- a canonical system checkout at `/srv/nixpi`
- a remote web app for chat and browser terminal access
- host automation through NixOS and systemd
- Pi runtime + extensions in one deployable system

## Quick start

Run on a fresh NixOS-capable VPS:

```bash
nix --extra-experimental-features 'nix-command flakes' run github:alexradunet/nixpi#nixpi-bootstrap-vps
```

Then operate from `/srv/nixpi`:

```bash
cd /srv/nixpi
git fetch origin
git rebase origin/main
sudo nixpi-rebuild
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
