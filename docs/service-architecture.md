# Service Architecture

> [Emoji Legend](LEGEND.md)

Bloom extends Pi's capabilities through three mechanisms, each suited to different needs. When Pi detects a capability gap or the user requests a new feature, choose the lightest mechanism that fits.

## Extensibility Hierarchy

```mermaid
graph TD
    gap[Capability Gap Detected] --> q1{Needs code<br/>execution or<br/>long-running process?}
    q1 -->|No| skill[Skill<br/>SKILL.md]
    q1 -->|Yes| q2{Needs direct access<br/>to Pi session?}
    q2 -->|Yes| ext[Extension<br/>TypeScript]
    q2 -->|No| svc[Service<br/>Container]

    skill --> skill_desc["Markdown file with instructions<br/>Cheapest to create<br/>No code, just knowledge"]
    ext --> ext_desc["In-process TypeScript<br/>Full Pi API access<br/>Commands, tools, events"]
    svc --> svc_desc["Containerized workload<br/>Isolated, resource-limited<br/>HTTP interaction"]

    style skill fill:#d5f5d5
    style ext fill:#d5d5f5
    style svc fill:#f5d5d5
```

### When to Use What

| Mechanism | Use When | Examples | Cost |
|-----------|----------|----------|------|
| **Skill** | Pi needs knowledge or a procedure to follow | meal-planning, troubleshooting guides, API references | Zero — just a markdown file |
| **Extension** | Pi needs to register commands, tools, or react to session events | bloom-objects (object store), bloom-garden (Bloom directory) | Low — TypeScript, runs in-process |
| **Service** | A standalone process needs to run independently of Pi's session | dufs (WebDAV), mautrix bridges (WhatsApp, Telegram) | Medium — systemd unit, resource allocation |

**Always prefer the lighter option.** A skill that teaches Pi to call an existing API is better than an extension wrapping that API, which is better than a service re-implementing it.

## System Overview

```mermaid
graph TB
    subgraph "Bloom OS (Fedora bootc)"
        subgraph "OS-Level Infrastructure"
            matrix_native[bloom-matrix.service<br/>Continuwuity Homeserver :6167]
            netbird[netbird.service<br/>Mesh VPN]
        end

        subgraph "Pi Agent Process"
            persona[bloom-persona]
            garden[bloom-garden]
            objects[bloom-objects]
        end

        subgraph "Service Containers (Podman Quadlet)"
            dufs[bloom-dufs<br/>WebDAV :5000]
            bridges[mautrix bridges<br/>WhatsApp, Telegram, Signal]
        end
    end

    bridges <-->|Appservice API| matrix_native
    netbird <-->|WireGuard| netbird_cloud[NetBird Cloud]
    dufs -->|WebDAV| devices[Other Devices]

    style persona fill:#e8d5f5
    style garden fill:#d5f5e8
    style objects fill:#d5e8f5
    style matrix_native fill:#f5f5d5
```

## The Three Layers

| Layer | Mechanism | Lifecycle | Communication | Created By |
|-------|-----------|-----------|---------------|------------|
| **Skills** | Markdown files (SKILL.md) | Discovered at session start | Pi reads and follows instructions | Pi (via `skill_create`) or developer |
| **Extensions** | In-process TypeScript | Loaded with Pi session | Direct API (ExtensionAPI) | Developer (requires code review + PR) |
| **Services** | Containers (Podman Quadlet) | systemd-managed, independent | HTTP, Matrix appservice API | Pi (via self-evolution) or developer |

### Why Three Layers?

- **Skills** are pure knowledge — procedures, API references, troubleshooting guides. Pi reads them and acts. No code, no process, no resources. Pi can create these autonomously.
- **Extensions** need direct access to Pi's session (send messages, register commands, access context). They run in-process and require TypeScript. These are core platform code.
- **Services** are standalone workloads (file sync, messaging bridges) that run as containers.

### Subdomain Routing Layer

When a service is installed via `service_install`, Bloom automatically creates subdomain routing:

1. **NetBird DNS** — Creates an A record `{name}.bloom.mesh` pointing to the device's mesh IP in a NetBird Custom DNS Zone. Requires `NETBIRD_API_TOKEN` in `~/.config/bloom/netbird.env`.

Services use host networking and are accessible directly at `http://{name}.bloom.mesh:{port}` from any mesh peer. No reverse proxy is needed.

**Graceful degradation**: If no NetBird token is configured, DNS is skipped. Services remain accessible via the device's mesh IP and port directly.

**Idempotency**: Zone and records are checked before creation. Zone ID is cached in `~/.config/bloom/netbird-zone.json` to avoid repeated API calls.

### OS-Level Infrastructure

Some services are foundational to the system's identity and run as native systemd services baked into the OS image:

| Unit | Purpose |
|------|---------|
| `bloom-matrix.service` | Continuwuity Matrix homeserver — communication backbone |
| `netbird.service` | Mesh networking — device reachability |

These are analogous to systemd, podman, and SSH — they're part of the OS, not optional services.

### The `bloom-` Prefix

Bloom-managed services use a `bloom-` prefix on their **unit names** (e.g., `bloom-dufs`). This is a management namespace — it does NOT mean the underlying image is Bloom-specific.

| Unit Name | Type | Image / Runtime | Bloom-specific? |
|-----------|------|-----------------|-----------------|
| `bloom-dufs` | Podman Quadlet (user) | `docker.io/sigoden/dufs:latest` | No — upstream image |
| `bloom-matrix` | Native systemd service | Continuwuity binary in OS image | Part of OS |
| `netbird` | System RPM service | NetBird package | No — upstream RPM |

The prefix enables:
- `systemctl --user status bloom-*` — list all Bloom-managed user services
- Clear separation from user-installed services

## Local Package Installation

Services are installed from bundled local packages in `services/{name}/`. Each package contains Quadlet container units and a SKILL.md file.

### Package Format

```
services/{name}/
├── quadlet/
│   ├── bloom-{name}.container    # Podman Quadlet unit
│   └── bloom-{name}-*.volume     # Volume definitions
└── SKILL.md                      # Skill file (frontmatter + API docs)
```

### Service Catalog

`services/catalog.yaml` is the declarative metadata index:

- `services:` — container service defaults (version, image, preflight requirements)
- `bridges:` — mautrix bridge metadata (image, health_port)

The `manifest_apply` tool uses the services catalog to auto-install missing services and enforce preflight checks.

## Service Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Installed: service_install (local package)
    Installed --> Running: systemctl --user start
    Running --> Stopped: systemctl --user stop
    Stopped --> Running: systemctl --user start
    Stopped --> Removed: Remove quadlet + skill files
    Removed --> [*]
    Running --> Removed: systemctl --user stop + remove files

    note right of Installed
        ~/.config/containers/systemd/bloom-{name}.container
        ~/Bloom/Skills/{name}/SKILL.md
    end note
```

## File System Layout

```mermaid
graph LR
    subgraph "Immutable OS Layer (/usr)"
        bloom_pkg["/usr/local/share/bloom/<br/>Extensions + Skills + Persona"]
        continuwuity["/usr/local/bin/continuwuity<br/>Matrix homeserver binary"]
    end

    subgraph "User State (~)"
        config["~/.config/containers/systemd/<br/>Installed Quadlet units"]
        bloom_dir["~/Bloom/<br/>Persona, skills, objects"]
        skills["~/Bloom/Skills/<br/>Installed service skills"]
        pi_state["~/.pi/<br/>Pi agent state"]
        matrix_creds["~/.pi/<br/>Matrix credentials, daemon state"]
    end

    subgraph "System State"
        matrix_data["/var/lib/continuwuity/<br/>Matrix homeserver data"]
        nb_state["/var/lib/netbird/<br/>NetBird identity"]
        appservices["/etc/bloom/appservices/<br/>Bridge registrations"]
    end

    bloom_pkg --> config
```

## Available Services

| Service | Category | Port | Type | Resources |
|---------|----------|------|------|-----------|
| bloom-dufs | sync | 5000 | Podman Quadlet | 64MB RAM |
| bloom-matrix | communication | 6167 | Native systemd | 512MB RAM |
| netbird | networking | — | System RPM | 256MB RAM |

## Adding a New Service

1. Create `services/{name}/quadlet/bloom-{name}.container` with Quadlet conventions
2. Create `services/{name}/SKILL.md` documenting the API and usage
3. Test locally: copy to `~/.config/containers/systemd/`, reload, start
4. Update the services table in `services/README.md` and `AGENTS.md`

### Quadlet Conventions Checklist

- [ ] Container name: `bloom-{name}`
- [ ] Network: host networking
- [ ] Health check defined (`HealthCmd`, `HealthInterval`, `HealthRetries`)
- [ ] Logging: `LogDriver=journald`
- [ ] Security: `NoNewPrivileges=true`
- [ ] Restart policy: `on-failure` with `RestartSec=10`
- [ ] Resource limits set (`--memory`)
- [ ] `WantedBy=default.target` in `[Install]`

## Related

- [Emoji Legend](LEGEND.md) — Notation reference
- [Supply Chain](supply-chain.md) — Artifact trust and releases
- [Quick Deploy](quick_deploy.md) — OS build and deployment
