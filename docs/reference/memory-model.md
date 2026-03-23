# Memory Model

> How NixPI stores and promotes memory

## 🌱 Audience

Maintainers changing memory tools, storage rules, or retrieval behavior.

## 🌱 Why NixPI Uses Markdown Memory

NixPI memory is intentionally file-based.

The goal is to keep memory:

- Inspectable by humans
- Editable without special tooling
- Lightweight enough for a minimal host footprint
- Explicit about what is durable versus temporary

## 🗂️ How The Memory Layers Work

NixPI has two persistent layers:

- `~/nixpi/Objects/` for durable long-term memory
- `~/nixpi/Episodes/` for append-only episodic capture

### Working Memory

Short-term continuity lives in `~/.pi/nixpi-context.json` and normal Pi session compaction.

Use this for:

- Current conversational continuity
- Recent task state
- Compacted session context

Do not treat working memory as canonical long-term truth.

### Episodic Memory

Episodes are raw observations stored under `~/nixpi/Episodes/YYYY-MM-DD/*.md`.

Use episodes for:

- Recent notable user statements
- Tool outcomes worth revisiting
- Decisions in progress
- Troubleshooting observations
- Raw material for later promotion

Episodes are cheap to write and should remain append-only.

### Durable Memory

Durable objects live in `~/nixpi/Objects/*.md`.

Use durable objects for:

- Stable facts
- Confirmed preferences
- Reusable procedures
- Explicit decisions
- Projects and open threads

Durable objects are the canonical long-term memory store.

## Promotion Rules

Promotion is the process of turning one or more episodes into durable objects.

Auto-promote only when the information is:

- Explicit rather than inferred
- Durable rather than transient
- Useful beyond the immediate turn
- High-confidence or directly confirmed

Poor promotion candidates:

- Speculation
- Transient moods
- One-off troubleshooting noise
- Weakly inferred personal facts
- Incomplete ideas with no durable value

## 📚 Reference

### Durable Object Required Fields

- `type`
- `slug`
- `title`
- `summary`
- `scope`
- `confidence`
- `status`
- `created`
- `modified`

### Common Optional Fields

- `scope_value`
- `tags`
- `links`
- `source`
- `salience`
- `last_accessed`
- `last_confirmed`

### Common Enums

**scope**: `global`, `host`, `project`, `room`, `agent`

**confidence**: `low`, `medium`, `high`

**status**: `active`, `stale`, `superseded`, `archived`

### Current Recommended Durable Types

- `fact`
- `preference`
- `project`
- `decision`
- `procedure`
- `thread`
- `relationship`

### Current Memory Transitions

1. `episode_create`
2. `episode_promote`
3. `episode_consolidate`

### Current Non-Goals

- SQLite
- Vector databases
- External memory services
- Automatic per-turn transcript logging
- Compaction summaries as canonical long-term memory

## 🔗 Related

- [Codebase: Pi Extensions - Objects](../codebase/pi-extensions)
- [Codebase: Pi Extensions - Episodes](../codebase/pi-extensions)
