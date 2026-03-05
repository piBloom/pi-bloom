# Service Architecture

Bloom extends Pi's capabilities through three mechanisms, each suited to different needs. When Pi detects a capability gap or the user requests a new feature, choose the lightest mechanism that fits.

## Extensibility Hierarchy

```mermaid
graph TD
    gap[Capability Gap Detected] --> q1{Needs code<br/>execution or<br/>long-running process?}
    q1 -->|No| skill[Skill<br/>SKILL.md]
    q1 -->|Yes| q2{Needs direct access<br/>to Pi session?}
    q2 -->|Yes| ext[Extension<br/>TypeScript]
    q2 -->|No| svc[Service<br/>OCI Container]

    skill --> skill_desc["Markdown file with instructions<br/>Cheapest to create<br/>No code, just knowledge"]
    ext --> ext_desc["In-process TypeScript<br/>Full Pi API access<br/>Commands, tools, events"]
    svc --> svc_desc["Containerized workload<br/>Isolated, resource-limited<br/>HTTP/bash interaction"]

    style skill fill:#d5f5d5
    style ext fill:#d5d5f5
    style svc fill:#f5d5d5
```

### When to Use What

| Mechanism | Use When | Examples | Cost |
|-----------|----------|----------|------|
| **Skill** | Pi needs knowledge or a procedure to follow | meal-planning, troubleshooting guides, API references | Zero — just a markdown file |
| **Extension** | Pi needs to register commands, tools, or react to session events | bloom-channels (Unix socket server), bloom-journal (daily entries) | Low — TypeScript, runs in-process |
| **Service** | A standalone process needs to run independently of Pi's session | Whisper (ML model), WhatsApp bridge (always-on), Tailscale (VPN) | Medium — container image, systemd unit, resource allocation |

**Always prefer the lighter option.** A skill that teaches Pi to call an existing API is better than an extension wrapping that API, which is better than a service re-implementing it.

## System Overview

```mermaid
graph TB
    subgraph "Bloom OS (Fedora bootc)"
        subgraph "Pi Agent Process"
            persona[bloom-persona]
            garden[bloom-garden]
            objects[bloom-objects]
            journal[bloom-journal]
            topics[bloom-topics]
            channels[bloom-channels<br/>Unix socket<br/>/run/bloom/channels.sock]
        end

        subgraph "Service Containers (Podman Quadlet)"
            wa[bloom-whatsapp<br/>Baileys Bridge]
            whisper[bloom-whisper<br/>faster-whisper :9000]
            tailscale[bloom-tailscale<br/>Tailscale VPN]
        end

        subgraph "System Services"
            syncthing[Syncthing<br/>:8384]
            systemd[systemd --user]
        end
    end

    channels <-->|Unix socket JSON| wa
    wa <-->|Baileys| whatsapp_cloud[WhatsApp Cloud]
    whisper -->|HTTP API| channels
    tailscale <-->|WireGuard| tailnet[Tailnet]
    syncthing <-->|Syncthing Protocol| devices[Other Devices]
    systemd -->|manages| wa
    systemd -->|manages| whisper
    systemd -->|manages| tailscale

    style persona fill:#e8d5f5
    style garden fill:#d5f5e8
    style objects fill:#d5e8f5
    style channels fill:#f5e8d5
```

## The Three Layers

| Layer | Mechanism | Lifecycle | Communication | Created By |
|-------|-----------|-----------|---------------|------------|
| **Skills** | Markdown files (SKILL.md) | Discovered at session start | Pi reads and follows instructions | Pi (via `skill_create`) or developer |
| **Extensions** | In-process TypeScript | Loaded with Pi session | Direct API (ExtensionAPI) | Developer (requires code review + PR) |
| **Services** | OCI containers via Podman Quadlet | systemd-managed, independent | Unix socket, HTTP, shell | Pi (via self-evolution) or developer |

### Why Three Layers?

- **Skills** are pure knowledge — procedures, API references, troubleshooting guides. Pi reads them and acts. No code, no process, no resources. Pi can create these autonomously.
- **Extensions** need direct access to Pi's session (send messages, register commands, access context). They run in-process and require TypeScript. These are core platform code.
- **Services** are standalone workloads (speech-to-text, messaging bridges, VPN) that benefit from container isolation, independent updates, and resource limits. Pi can create and distribute these via OCI artifacts.

### The `bloom-` Prefix

Service containers use a `bloom-` prefix on their **Quadlet unit names** (e.g., `bloom-whisper`, `bloom-tailscale`). This is a management namespace — it does NOT mean the container image is Bloom-specific. Most services use upstream images directly:

| Quadlet Name | Container Image | Bloom-specific? |
|-------------|-----------------|-----------------|
| `bloom-whisper` | `fedirz/faster-whisper-server@sha256:760e5e43d427dc6cfbbc4731934b908b7de9c7e6d5309c6a1f0c8c923a5b6030` | No — upstream image |
| `bloom-tailscale` | `tailscale/tailscale@sha256:95e528798bebe75f39b10e74e7051cf51188ee615934f232ba7ad06a3390ffa1` | No — upstream image |
| `bloom-whatsapp` | `ghcr.io/alexradunet/bloom-whatsapp:latest` | Yes — custom bridge |

The prefix enables:
- `systemctl --user status bloom-*` — list all Bloom-managed services
- `ls ~/.config/containers/systemd/bloom-*.container` — discover installed services
- Clear separation from user-installed containers

## OCI Artifact Distribution

Service packages are distributed as OCI artifacts via GHCR, using `oras` for push/pull.

```mermaid
sequenceDiagram
    participant Dev as Developer
    participant GHCR as ghcr.io
    participant Bloom as Bloom Device
    participant Pi as Pi Agent

    Note over Dev: Create service package
    Dev->>Dev: services/{name}/quadlet/ + SKILL.md
    Dev->>GHCR: just svc-push {name}<br/>oras push

    Note over Bloom: Install service
    Pi->>GHCR: oras pull bloom-svc-{name}
    Pi->>Bloom: Copy quadlet → ~/.config/containers/systemd/
    Pi->>Bloom: Copy SKILL.md → ~/Garden/Bloom/Skills/{name}/
    Pi->>Bloom: systemctl --user daemon-reload
    Pi->>Bloom: systemctl --user start bloom-{name}

    Note over Bloom: Self-evolution (future)
    Pi->>Pi: Detect capability gap
    Pi->>Pi: Create service package
    Pi->>GHCR: oras push bloom-svc-{name}
    Pi->>Pi: Share with other Bloom devices
```

### Package Format

```
services/{name}/
├── quadlet/
│   ├── bloom-{name}.container    # Podman Quadlet unit
│   └── bloom-{name}-*.volume     # Volume definitions
└── SKILL.md                      # Skill file (frontmatter + API docs)
```

### OCI Annotations

```
org.opencontainers.image.title       = bloom-{name}
org.opencontainers.image.description = Human-readable description
org.opencontainers.image.source      = https://github.com/alexradunet/bloom
org.opencontainers.image.version     = 1.0.0
dev.bloom.service.category           = media | communication | networking
dev.bloom.service.port               = 9000
```

## Service Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Available: Published to GHCR
    Available --> Pulled: oras pull
    Pulled --> Installed: Copy quadlet + SKILL.md
    Installed --> Running: systemctl --user start
    Running --> Stopped: systemctl --user stop
    Stopped --> Running: systemctl --user start
    Stopped --> Removed: Remove quadlet + skill files
    Removed --> [*]
    Running --> Removed: systemctl --user stop + remove files

    note right of Available
        ghcr.io/alexradunet/bloom-svc-{name}
    end note

    note right of Installed
        ~/.config/containers/systemd/bloom-{name}.container
        ~/Garden/Bloom/Skills/{name}/SKILL.md
    end note
```

## Media Pipeline

When WhatsApp receives a voice note or image, the media flows through multiple services:

```mermaid
sequenceDiagram
    participant WA as WhatsApp Cloud
    participant Bridge as bloom-whatsapp
    participant FS as /var/lib/bloom/media/
    participant Channels as bloom-channels
    participant Pi as Pi Agent
    participant Whisper as bloom-whisper

    WA->>Bridge: Incoming voice note
    Bridge->>Bridge: downloadMediaMessage()
    Bridge->>FS: Save as {timestamp}-{id}.ogg
    Bridge->>Channels: Unix socket JSON with media metadata
    Channels->>Pi: "[whatsapp: John] sent audio (15s, 24KB, audio/ogg). File: /var/lib/bloom/media/..."

    Note over Pi: Pi decides to transcribe
    Pi->>Whisper: POST /v1/audio/transcriptions<br/>file=@/var/lib/bloom/media/...ogg
    Whisper->>Pi: {"text": "transcribed content"}
    Pi->>Channels: Response text
    Channels->>Bridge: Unix socket JSON response
    Bridge->>WA: Send reply
```

### Media Message Format (Channel Protocol)

```json
{
  "type": "message",
  "channel": "whatsapp",
  "from": "John",
  "timestamp": 1709568000,
  "media": {
    "kind": "audio",
    "mimetype": "audio/ogg",
    "filepath": "/var/lib/bloom/media/1709568000-abc123.ogg",
    "duration": 15,
    "size": 24576,
    "caption": null
  }
}
```

## File System Layout

```mermaid
graph LR
    subgraph "Immutable OS Layer (/usr)"
        bloom_pkg["/usr/local/share/bloom/<br/>Extensions + Skills + Persona"]
        oras_bin["/usr/local/bin/oras"]
    end

    subgraph "User State (/var/lib/bloom)"
        config["~/.config/containers/systemd/<br/>Installed Quadlet units"]
        garden["~/Garden/<br/>Synced vault"]
        skills["~/Garden/Bloom/Skills/<br/>Installed service skills"]
        media["/var/lib/bloom/media/<br/>Downloaded media files"]
        pi_state["~/.pi/<br/>Pi agent state"]
    end

    subgraph "Container Volumes"
        wa_auth["bloom-whatsapp-auth<br/>WhatsApp credentials"]
        whisper_models["bloom-whisper-models<br/>ML model cache"]
        ts_state["bloom-tailscale-state<br/>Tailscale identity"]
    end

    bloom_pkg --> config
    config --> wa_auth
    config --> whisper_models
    config --> ts_state
```

## Available Services

| Service | Category | Port | Image | Resources |
|---------|----------|------|-------|-----------|
| bloom-whatsapp | communication | — | ghcr.io/alexradunet/bloom-whatsapp | 128MB RAM |
| bloom-whisper | media | 9000 | fedirz/faster-whisper-server@sha256:760e5e43d427dc6cfbbc4731934b908b7de9c7e6d5309c6a1f0c8c923a5b6030 | 2GB RAM |
| bloom-tailscale | networking | — | tailscale/tailscale@sha256:95e528798bebe75f39b10e74e7051cf51188ee615934f232ba7ad06a3390ffa1 | 256MB RAM |

## Adding a New Service

1. Create `services/{name}/quadlet/bloom-{name}.container` with Quadlet conventions
2. Create `services/{name}/SKILL.md` documenting the API and usage
3. Test locally: copy to `~/.config/containers/systemd/`, reload, start
4. Push to GHCR: `just svc-push {name}`
5. Update the services table in `services/README.md` and `AGENTS.md`

### Quadlet Conventions Checklist

- [ ] Container name: `bloom-{name}`
- [ ] Network: prefer `bloom.network` isolation (`host` only when required, e.g. VPN)
- [ ] Health check defined (`HealthCmd`, `HealthInterval`, `HealthRetries`)
- [ ] Logging: `LogDriver=journald`
- [ ] Security: `NoNewPrivileges=true`
- [ ] Restart policy: `on-failure` with `RestartSec=10`
- [ ] Resource limits set (`--memory`)
- [ ] `WantedBy=default.target` in `[Install]`
