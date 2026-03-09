# piBloom

> 📖 [Emoji Legend](docs/LEGEND.md)

A personal AI companion that lives on a quiet box on your shelf or on a repove VPS, your choice. piBloom is a Fedora bootc OS image that makes [Pi](https://github.com/nicholasgasior/pi-coding-agent) a first-class citizen — extending it with knowledge of its host, a persistent memory store, and a growing identity that evolves alongside you.

You "plant" your mini-PC and over time it grows and blooms with you.

## 🌱 What It Is

Bloom is a **Pi package** — a bundle of extensions, skills, and services that teach Pi about its environment. When installed on a Fedora bootc system, Pi becomes a sovereign personal AI that:

- **Remembers** — flat-file object store with YAML frontmatter in `~/Bloom/Objects/`
- **Manages its own OS** — bootc updates, rollbacks, container lifecycle, systemd services
- **Communicates** — channel bridges (Matrix via Element bot) over Unix socket IPC
- **Evolves** — structured self-improvement workflow, persona that grows from Seed to Bloom
- **Stays private** — no cloud, no telemetry. Your thoughts never leave your box.

## 🌱 Architecture

Bloom extends Pi through three mechanisms, lightest first:

| Layer | What | When |
|-------|------|------|
| **Skill** | Markdown instructions (SKILL.md) | Pi needs knowledge or a procedure |
| **Extension** | In-process TypeScript module | Pi needs tools, commands, or event hooks |
| **Service** | Container (Podman Quadlet) | Standalone workload needing isolation |

Always prefer the lightest option.

```mermaid
graph TD
    Pi[🤖 Pi Agent] --> Skills[📜 Skills<br/>Markdown instructions]
    Pi --> Extensions[🧩 Extensions<br/>In-process TypeScript]
    Pi --> Services[📦 Services<br/>Containers]
    Extensions --> BloomDir[🌿 Bloom Directory<br/>~/Bloom/]
    Services --> BloomDir
    Extensions --> Persona[🪞 Persona<br/>4-layer identity]

    style Pi fill:#f5e8d5
    style Skills fill:#d5f5d5
    style Extensions fill:#d5d5f5
    style Services fill:#f5d5d5
    style BloomDir fill:#d5f5e8
    style Persona fill:#e8d5f5
```

### 🧩 Extensions

| Extension | Purpose |
|-----------|---------|
| `bloom-persona` | Identity injection, safety guardrails, compaction guidance |
| `bloom-audit` | Tool-call audit trail, retention, and review |
| `bloom-os` | bootc, Podman, systemd management |
| `bloom-repo` | Repository management, PR-based self-evolution |
| `bloom-services` | Service lifecycle (scaffold, install, test) and manifest management |
| `bloom-objects` | Flat-file object store (CRUD with YAML frontmatter) |
| `bloom-garden` | Bloom directory, blueprint seeding, skill discovery |
| `bloom-channels` | Channel bridge Unix socket server |
| `bloom-topics` | Topic management and session organization |
| `bloom-display` | AI computer use: screenshots, input, accessibility tree, window management |

### 📜 Skills

| Skill | Purpose |
|-------|---------|
| `first-boot` | One-time system setup guide |
| `os-operations` | System health inspection and remediation |
| `object-store` | CRUD operations for the memory store |
| `service-management` | Install, manage, and discover bundled service packages |
| `self-evolution` | Structured system change workflow |
| `recovery` | System recovery procedures |

### 📦 Services

Modular capabilities running as containers:

| Service | What | Type |
|---------|------|------|
| `bloom-lemonade` | Unified local AI (LLM, STT, TTS, image gen) | Podman Quadlet |
| `bloom-dufs` | WebDAV file server | Podman Quadlet |
| `bloom-matrix` | Continuwuity Matrix homeserver | Podman Quadlet |
| `bloom-element` | Matrix bot bridge (matrix-bot-sdk) | Podman Quadlet |
| `netbird` | Mesh VPN | System RPM service |

### 🪞 Persona

Bloom has an [OpenPersona](persona/) 4-layer identity seeded to `~/Bloom/Persona/` on first boot:

- **SOUL.md** — Identity, values, voice, boundaries
- **BODY.md** — Channel adaptation, presence behavior
- **FACULTY.md** — Reasoning patterns, decision frameworks
- **SKILL.md** — Current capabilities inventory

### 🌿 Bloom Directory

The Bloom directory (`~/Bloom/`) holds Bloom's configuration and data, accessible across devices via dufs WebDAV:

```
~/Bloom/
├── Persona/      # 4-layer identity files
├── Skills/       # Installed skill files
├── Evolutions/   # Proposed system changes
└── Objects/      # Tracked objects (notes, tasks, etc.)
```

## 🗂️ Project Structure

```
bloom/
├── extensions/       # TypeScript Pi extensions
├── lib/              # Shared utilities (frontmatter, logging, paths)
├── skills/           # SKILL.md procedure guides
├── services/         # Bundled service packages
├── persona/          # OpenPersona 4-layer identity
├── os/               # Fedora bootc 42 image (Containerfile + config)
├── tests/            # Unit, integration, and e2e tests
├── docs/             # Architecture and deployment guides
├── guardrails.yaml   # Safety rules for tool execution
└── justfile          # Build, image generation, VM management
```

## 🚀 Getting Started

### 🤖 Install as a Pi Package

```bash
pi install /path/to/bloom
```

### 💻 Development

```bash
npm install
npm run build          # tsc --build
npm run check          # biome lint + format check
npm run check:fix      # biome auto-fix
npm run test           # vitest
npm run test:coverage  # with 80% threshold enforcement
```

Load extensions for development:

```bash
pi install ./
```

### 💻 Build the OS Image

Requires: `sudo dnf install just qemu-system-x86 edk2-ovmf`

```bash
just build             # podman build container image
just qcow2             # generate qcow2 disk image
just iso               # generate Anaconda installer ISO
just vm                # boot in QEMU (graphical + SSH on :2222)
just vm-ssh            # ssh into running VM
just vm-kill           # stop VM
just clean             # remove os/output/
```

### 🚀 First Boot

Once the OS is running, the `first-boot` skill walks through setup:

1. Configure LLM provider + API key
2. GitHub authentication
3. Device git identity
4. dufs setup (WebDAV file server)
5. Optional services (Matrix, Element, Lemonade, NetBird)

See [docs/pibloom-setup.md](docs/pibloom-setup.md) for the full guide.

## 💻 OS Image

The Bloom OS image (`os/Containerfile`) is based on **Fedora bootc 42** and includes:

- **Runtime**: Node.js, Pi, Claude Code
- **Containers**: Podman, Buildah, Skopeo, oras
- **Desktop**: Xvfb (headless X11 framebuffer for AI computer use), tmux
- **Dev tools**: git, gh, ripgrep, fd, bat, VS Code
- **User**: `pi` with rootless Podman and passwordless sudo for first-boot

Atomic updates via `bootc upgrade` with automatic rollback support.

## 📖 Conventions

- **TypeScript**: strict, ES2022, NodeNext
- **Formatting**: Biome (tabs, double quotes, 120 line width)
- **Containers**: `Containerfile` (not Dockerfile), `podman` (not docker)
- **Extensions**: `export default function(pi: ExtensionAPI) { ... }` pattern
- **Skills**: SKILL.md with YAML frontmatter

## 📖 Docs

- [Service Architecture](docs/service-architecture.md) — extensibility hierarchy details
- [Quick Deploy](docs/quick_deploy.md) — OS build and deployment
- [First Boot Setup](docs/pibloom-setup.md) — initial configuration guide
- [Channel Protocol](docs/channel-protocol.md) — Unix socket IPC spec
- [Supply Chain](docs/supply-chain.md) — artifact trust and releases
- [Fleet PR Workflow](docs/fleet-pr-workflow.md) — multi-device contribution flow

## 🔗 Related

- [Emoji Legend](docs/LEGEND.md) — Notation reference
- [AGENTS.md](AGENTS.md) — Extension, tool, and hook reference
- [Service Architecture](docs/service-architecture.md) — Extensibility hierarchy details
