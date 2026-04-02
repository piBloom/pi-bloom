# AGENTS.md

Repository rules for coding agents working in this repo.

## Canonical repository

The canonical source-of-truth repository on this machine is:

`/srv/nixpi`

## Required workflow

When making changes for this repo, always:

- Edit files in `/srv/nixpi`
- Run `git` commands in `/srv/nixpi`
- Rebuild from `/srv/nixpi`
- Commit and push from `/srv/nixpi`

Preferred rebuild command:

`sudo nixos-rebuild switch --flake /srv/nixpi#nixpi`

## Do not default to proposal/apply clones

Do not treat any proposal, state, cache, or apply clone as the source-of-truth repo unless the user explicitly asks.

In particular, do not default to:

- `/var/lib/nixpi/pi-nixpi`
- `~/.nixpi/pi-nixpi`

Those paths may exist for local apply/proposal workflows, but they are not the canonical upstream-working repository for this machine.

## If there is ambiguity

If a task could be performed in multiple repo copies, prefer `/srv/nixpi` and ask the user before using another path.
