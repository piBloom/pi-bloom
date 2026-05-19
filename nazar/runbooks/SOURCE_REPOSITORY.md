# Source repository

Nazar's canonical Git repository is hosted on Codeberg. The canonical local checkout on the Nazar VPS is `/home/alex/repos/nazar`.

Do not use `/repos/nazar`, `/root/nazar`, `/srv/nazar`, or stale checkouts under `/persist/repos` as the source of truth unless this runbook and `nix/fleet/host.nix` are intentionally changed first.

## Canonical local path

```text
/home/alex/repos/nazar
```

This path is declared in `nix/fleet/host.nix` as `repository.localPath` and is the directory from which host switches should be run.

## Canonical remote

- Web: <https://codeberg.org/NazarStudio/Nazar>
- SSH Git: `git@codeberg.org:NazarStudio/Nazar.git`

The same locations are declared in `nix/fleet/host.nix` under `repository`.

## Policy

- Do not run a Git server on `nazar`.
- Do not recreate `git.nazar.studio` or `/persist/git` in the NixOS host config.
- Do not maintain parallel Nazar infrastructure checkouts as active deployment sources.
- Use Codeberg for pushes, pulls, issues, and repository browsing.
- Keep host SSH for administration and local service forwarding only.

## Local remote setup

```bash
git remote add codeberg git@codeberg.org:NazarStudio/Nazar.git
```

Validate access with:

```bash
git ls-remote git@codeberg.org:NazarStudio/Nazar.git
```
