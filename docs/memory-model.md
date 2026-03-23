# NixPI Memory Model

> 📖 [Emoji Legend](LEGEND.md)

Audience: maintainers changing memory tools, storage rules, or retrieval behavior.

## 🌱 Why NixPI Uses Markdown Memory

NixPI memory is intentionally file-based.

The goal is to keep memory:

- inspectable by humans
- editable without special tooling
- lightweight enough for a minimal host footprint
- explicit about what is durable versus temporary

## 🗂️ How The Memory Layers Work

NixPI has two persistent layers:

- `~/nixpi/Objects/` for durable long-term memory
- `~/nixpi/Episodes/` for append-only episodic capture

### Working Memory

Short-term continuity lives in `~/.pi/nixpi-context.json` and normal Pi session compaction.

Use this for:

- current conversational continuity
- recent task state
- compacted session context

Do not treat working memory as canonical long-term truth.

### Episodic Memory

Episodes are raw observations stored under `~/nixpi/Episodes/YYYY-MM-DD/*.md`.

Use episodes for:

- recent notable user statements
- tool outcomes worth revisiting
- decisions in progress
- troubleshooting observations
- raw material for later promotion

Episodes are cheap to write and should remain append-only.

### Durable Memory

Durable objects live in `~/nixpi/Objects/*.md`.

Use durable objects for:

- stable facts
- confirmed preferences
- reusable procedures
- explicit decisions
- projects and open threads

Durable objects are the canonical long-term memory store.

### Promotion Rules

Promotion is the process of turning one or more episodes into durable objects.

Auto-promote only when the information is:

- explicit rather than inferred
- durable rather than transient
- useful beyond the immediate turn
- high-confidence or directly confirmed

Poor promotion candidates:

- speculation
- transient moods
- one-off troubleshooting noise
- weakly inferred personal facts
- incomplete ideas with no durable value

## 📚 Reference

Durable object required fields:

- `type`
- `slug`
- `title`
- `summary`
- `scope`
- `confidence`
- `status`
- `created`
- `modified`

Common optional fields:

- `scope_value`
- `tags`
- `links`
- `source`
- `salience`
- `last_accessed`
- `last_confirmed`

Common enums:

- `scope`: `global`, `host`, `project`, `room`, `agent`
- `confidence`: `low`, `medium`, `high`
- `status`: `active`, `stale`, `superseded`, `archived`

Current recommended durable types:

- `fact`
- `preference`
- `project`
- `decision`
- `procedure`
- `thread`
- `relationship`

Current memory transitions:

1. `episode_create`
2. `episode_promote`
3. `episode_consolidate`

Current non-goals:

- SQLite
- vector databases
- external memory services
- automatic per-turn transcript logging
- compaction summaries as canonical long-term memory

## 🔗 Related

- [../AGENTS.md](../AGENTS.md)
- [../README.md](../README.md)
