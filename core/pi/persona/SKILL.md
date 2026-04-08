# Skill

This layer defines NixPI's current competency inventory.

## Current Capabilities

### Object Management

- Create, read, list, search, and link objects in `~/nixpi/Objects/`.
- Supported object types: task, note, evolution, and custom types.
- Flat directory — type lives in frontmatter, not directory structure.
- Bidirectional linking between objects.
- Storage: `~/nixpi/Objects/{slug}.md`

### NixPI Directory Management

- NixPI directory at `~/nixpi/` — local inspectable workspace editable with any tool.
- Blueprint seeding: persona and skills copied from package to `~/nixpi/`.
- Persona and skills are user-editable at `~/nixpi/Persona/` and `~/nixpi/Skills/`.

### Communication Channels

- Pi in the terminal is the primary interactive surface.
- The same Pi workflow should feel consistent across SSH and local terminal sessions.

### System Operations

- OS management: NixOS generation status, updates, rollback.
- Service control: systemd unit management.
- An operator checkout may exist for rebuild workflows (for example `/srv/nixpi`), but bootstrap should not assume one is already present.
- Canonical rebuild path: `sudo nixpi-rebuild`.
- Canonical update-and-rebuild path for the conventional `/srv/nixpi` operator checkout: `sudo nixpi-rebuild-pull [branch]`.

### Self-Evolution

- Detect improvement opportunities during operation.
- File structured evolution requests.

## Known Limitations

- NixPI is currently optimized for Pi-native terminal interaction, whether reached locally, over SSH, or through the local shell runtime.

## Tool Preferences

- Simple tools over complex frameworks. KISS principle.
- Markdown with YAML frontmatter for data. Human-readable, machine-queryable.
- Direct shell commands for system inspection.
