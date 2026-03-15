# Bloom

> 📖 [Emoji Legend](docs/LEGEND.md)

Very opinionated Fedora BootC OS build personally for me and my workflows and how I imagine a PC will be in the future. My goal is to leverage the current AI Agents Technology to build an AI Firsts OS designed specifically for one end user to act like a personal life assistant and knowledge management system.

It is very experimental and I am still currently developing it based on my needs and my own code engineering preferences.

The project aims to fully leverage the European Union infrastructure, ai and privacy laws. Right now the only good AI Alternative in European Union is Mistral, but I don't feel it's strong enough yet and also I haven't checked if we can use their oAuth. For now I am using Claude Code for development, Codex and Pi.

I am gonna be honest, I have leveraged quite a big of AI Agents, so you can consider it AI Slop. Me, I consider it my baby and I am really glad for the AI Agents because without them, I wouldn't have had the time to learn all of this in detail and then try to build it. This is not my first project like this, I have dabbled with experiments regarding this area in the last years, and this is the culmination of my preffered arhcitectural and coding patterns and with the technologies that I consider worthwhile.

I plan to keep this project as minimal as possible in order to leave the end user to evolve it's own OS using Pi agent.

The end goal for this project would be for you guys to fork this repo ( we will set it as a template repo ) and then start to build your own OS on this base and share it with your friends.

## 🌱 Why Bloom Exists

BloomOS packages Pi, host integration, memory, and optional services into one self-hosted system.

Bloom exists to give Pi:

- a durable home directory under `~/Bloom/`
- first-class host tools for OS, services, and repo workflows
- a private Matrix-based messaging surface
- a minimal but inspectable operating model based on files, systemd, and containers

## 🚀 What Ships Today

Current platform capabilities:

- Bloom directory management and blueprint seeding for `~/Bloom/`
- persona injection, shell guardrails, durable-memory digest injection, and compaction context persistence
- audit logging for tool calls and tool results
- host OS management tools for `bootc`, containers, systemd, health, and reboot scheduling
- repo bootstrap, sync, and PR submission helpers
- service scaffolding, installation, smoke testing, manifest management, and bridge lifecycle tools
- markdown-native durable memory in `~/Bloom/Objects/`
- append-only episodic memory in `~/Bloom/Episodes/`
- a Matrix room daemon with single-agent fallback and optional multi-agent routing
- proactive daemon jobs for heartbeat and simple cron-style scheduled turns
- a first-boot flow split between a bash wizard and a Pi-guided persona step

## 🧭 Start Here

Choose the entry point that matches your job:

- Maintainers: [ARCHITECTURE.md](ARCHITECTURE.md), [AGENTS.md](AGENTS.md), and [docs/README.md](docs/README.md)
- Operators: [docs/pibloom-setup.md](docs/pibloom-setup.md), [docs/quick_deploy.md](docs/quick_deploy.md), and [docs/live-testing-checklist.md](docs/live-testing-checklist.md)
- Service/package work: [docs/service-architecture.md](docs/service-architecture.md) and [services/README.md](services/README.md)

## 💻 Default Install

The base image stays intentionally small.

Installed by default:

- `sshd.service`
- `netbird.service`
- `bloom-matrix.service`
- `pi-daemon.service` after setup once AI auth and defaults are ready

Optional packaged services:

- `cinny`
- `dufs`
- `code-server`

Optional bridge workloads:

- `whatsapp`
- `telegram`
- `signal`

## 🌿 Repository Layout

| Path | Purpose |
|------|---------|
| `core/` | Bloom core: OS image, daemon, persona, skills, built-in extensions, and shared runtime code |
| `core/pi-extensions/` | Pi-facing Bloom extensions, including dev and repo tooling |
| `services/` | bundled service packages and service metadata |
| `tests/` | unit, integration, daemon, and extension tests |
| `docs/` | live project documentation |

## 🧩 Capability Model

Bloom extends Pi through three layers:

| Layer | What it is | Typical use |
|------|-------------|-------------|
| 📜 Skill | markdown instructions in `SKILL.md` | procedures, guidance, checklists |
| 🧩 Extension | in-process TypeScript | Pi-facing tools, hooks, commands |
| 📦 Service | packaged container workload | isolated long-running software |

OS-level infrastructure sits beside those layers:

- `bloom-matrix.service`
- `netbird.service`
- `pi-daemon.service`

See [docs/service-architecture.md](docs/service-architecture.md) for the full capability model.

## 📚 Documentation Map

The documentation system is organized as `Why / How / Reference`.

| Topic | Why | How | Reference |
|------|-----|-----|-----------|
| Docs hub | [docs/README.md](docs/README.md) | [docs/README.md](docs/README.md) | [docs/README.md](docs/README.md) |
| Architecture | [ARCHITECTURE.md](ARCHITECTURE.md) | [ARCHITECTURE.md](ARCHITECTURE.md) | [AGENTS.md](AGENTS.md) |
| Daemon | [docs/daemon-architecture.md](docs/daemon-architecture.md) | [docs/daemon-architecture.md](docs/daemon-architecture.md) | [AGENTS.md](AGENTS.md) |
| Services | [docs/service-architecture.md](docs/service-architecture.md) | [services/README.md](services/README.md) | [docs/service-architecture.md](docs/service-architecture.md) |
| Setup / deploy | [docs/pibloom-setup.md](docs/pibloom-setup.md) | [docs/quick_deploy.md](docs/quick_deploy.md) | [docs/live-testing-checklist.md](docs/live-testing-checklist.md) |
| Memory | [docs/memory-model.md](docs/memory-model.md) | [docs/memory-model.md](docs/memory-model.md) | [AGENTS.md](AGENTS.md) |
| Trust / supply chain | [docs/supply-chain.md](docs/supply-chain.md) | [docs/supply-chain.md](docs/supply-chain.md) | [docs/supply-chain.md](docs/supply-chain.md) |
| Contribution workflow | [docs/fleet-pr-workflow.md](docs/fleet-pr-workflow.md) | [docs/fleet-pr-workflow.md](docs/fleet-pr-workflow.md) | [AGENTS.md](AGENTS.md) |

## 🔗 Related

- [docs/README.md](docs/README.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [AGENTS.md](AGENTS.md)
