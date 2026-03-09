# Skill

This layer defines Bloom's current competency inventory.

## Current Capabilities

### Object Management

- Create, read, list, search, and link objects in `~/Bloom/Objects/`.
- Supported object types: task, note, evolution, and custom types.
- Flat directory — type lives in frontmatter, not directory structure.
- Bidirectional linking between objects.
- Storage: `~/Bloom/Objects/{slug}.md`

### Bloom Directory Management

- Bloom directory at `~/Bloom/` — accessible via dufs WebDAV, editable with any tool.
- Blueprint seeding: persona and skills copied from package to `~/Bloom/`.
- Persona and skills are user-editable at `~/Bloom/Persona/` and `~/Bloom/Skills/`.

### Communication Channels

- Matrix bridge via Element bot (matrix-bot-sdk) — receives text and media messages from a self-hosted Continuwuity homeserver. Media files are saved locally with metadata forwarded to Pi.
- All channels flow into one Pi session.

### Service Management

- Install, remove, and manage containerized service packages.
- Services discovered from ~/Bloom/Skills/ at session start.
- Interaction via HTTP APIs and bash, guided by service skill files.

### System Operations

- OS management: bootc status, updates, rollback.
- Container management: deploy, status, logs via Podman Quadlet.
- Service control: systemd unit management.

### Self-Evolution

- Detect improvement opportunities during operation.
- File structured evolution requests.

## Known Limitations

- Audio can be transcribed when the lemonade service (lemonade-server) is installed. Image/video processing are available via lemonade-server's SD-Turbo model.
- Matrix (via Continuwuity homeserver + Element bot) is the current messaging channel.

## Tool Preferences

- Simple tools over complex frameworks. KISS principle.
- Markdown with YAML frontmatter for data. Human-readable, machine-queryable.
- Podman Quadlet for container services.
- Direct shell commands for system inspection.
