# Life OS

Life OS is a small, standards-first personal data store under `/srv/life`.
Hermes and humans should operate it through plain files and the `life` CLI.

## Design

- Canonical data lives in `/srv/life`, not in Hermes, MCP, or a database.
- Storage is human-readable: Markdown, todo.txt-style files, JSONL, YAML, and
  iCalendar.
- NixOS owns installation and base directory permissions.
- The CLI is TypeScript run with Bun. It uses built-in runtime APIs only.

## Layout

```text
/srv/life/
  README.md
  config/life.yaml
  calendar/personal.ics
  calendar/reminders.ics
  tasks/inbox.todo
  tasks/next.todo
  tasks/someday.todo
  tasks/done.todo
  projects/active/
  projects/archived/
  journal/YYYY/YYYY-MM-DD.md
  habits/habits.yaml
  habits/log.jsonl
  notes/
  exports/
  scripts/
  var/cache/
  var/indexes/
  var/state/
```

## CLI

The default root is `/srv/life`. For tests or one-off use, set `LIFE_ROOT` or
pass `--root PATH`.

```sh
life check
life status
life journal add "Short journal note"
life task add "Process inbox"
life task add "Draft review" --list next
life task list
life task list next
life task done 1
life habit log exercise "walk"
life review daily
```

`life check` creates missing directories and starter files. It does not overwrite
existing files.

## NixOS

`nix/modules/host/life-os.nix` installs the `life` package and declares
`/srv/life` tmpfiles entries owned by `alex:users` with mode `0750`.

The flake exposes:

```sh
nix build .#life-os
nix flake check
```

## Phase 2 Boundary

This implementation intentionally does not include sync, MCP, a web app,
daemons, CalDAV, a database, plugins, or dashboards. Those should be added only
when a concrete workflow needs them.
