---
name: object-store
description: Create, read, search, and link objects in ~/Bloom/Objects/
---

# Object Store Skill

Use this skill when the user wants to create, read, search, or link any type of object in Bloom's object store.

## Storage Model

Every object is a Markdown file with YAML frontmatter stored in a flat directory:
```
~/Bloom/Objects/{slug}.md
```

The type lives in frontmatter, not in the directory structure.

### Core frontmatter fields

- `type`: object type (e.g. `task`, `note`, `evolution`)
- `slug`: kebab-case unique identifier
- `title`: human-readable name
- `origin`: `pi` for AI-created, `user` for human-created
- `created`: ISO timestamp (set automatically)
- `modified`: ISO timestamp (updated automatically)
- `tags`: comma-separated labels
- `links`: references to related objects in `type/slug` format

### Object types

| Type | Purpose |
|------|---------|
| `task` | Actionable items with status and priority |
| `note` | Reference notes, permanent records |
| `evolution` | Proposed system changes |
| *(custom)* | Any type the user or agent defines |

## Available Tools

### Object Tools

- `memory_create` — Create a new object with type, slug, and fields.
- `memory_read` — Read an object by type and slug.
- `memory_list` — List objects, filtered by type or frontmatter fields.
- `memory_search` — Search objects by content pattern.
- `memory_link` — Create bidirectional links between objects.

### Bloom Directory Tools

- `garden_status` — Show Bloom directory location, file counts, and blueprint state.
- `/bloom init` — Initialize or re-initialize the Bloom directory.
- `/bloom update-blueprints` — Apply pending blueprint updates from package.

## When to Use Each Tool

| Situation | Tool |
|-----------|------|
| User mentions something new to track | `memory_create` |
| User asks about a specific item | `memory_read` |
| User wants to see items of a type | `memory_list` |
| User remembers content but not the name | `memory_search` |
| Two objects are related | `memory_link` |

## Behavior Guidelines

- Always set `title` when creating objects.
- Prefer update over create when an object already exists.
- After search, offer to read matched objects.
- Use link proactively when connections are mentioned.
- The Bloom directory is synced via Syncthing — files may be edited externally.
