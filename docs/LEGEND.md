# 📖 Emoji Legend

This document defines the emoji notation used across Bloom documentation for visual scanning and consistent reference.

## Notation Table

| Emoji | Concept |
|-------|---------|
| 🌱 | Bloom (the platform) |
| 🤖 | Pi (the agent) |
| 📜 | Skill |
| 🧩 | Extension |
| 📦 | Service (OCI container) |
| 🌿 | Garden (vault) |
| 🪞 | Persona |
| 💻 | OS / bootc |
| 📡 | Channels / IPC |
| 🛡️ | Guardrails / Safety |
| 📓 | Journal |
| 🔍 | Audit |
| 🗂️ | Objects / Memory |
| 🚀 | Deploy / Build |

## Usage

- **Section headers** use emojis as visual anchors (e.g., `## 🧩 Extensions`)
- **Table rows** use emojis as type prefixes for scanning
- **CLAUDE.md is excluded** — it's loaded into AI context windows and must stay lean
- **`SKILL.md` and `core/persona/` files are excluded** — they're consumed by Pi at runtime, not developers

## 🔗 Related

- [README](../README.md) — Project overview
- [AGENTS.md](../AGENTS.md) — Extension, tool, and hook reference
- [Service Architecture](service-architecture.md) — Extensibility hierarchy details
