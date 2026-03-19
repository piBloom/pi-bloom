# 📖 Emoji Legend

This document defines the emoji notation used across nixPI documentation for visual scanning and consistent reference.

## 🧩 Notation Table

| Emoji | Concept |
|-------|---------|
| 🌱 | nixPI / purpose / overview |
| 🤖 | Pi / agent behavior |
| 📜 | Skill / written guidance |
| 🧩 | Extension / integration layer |
| 📦 | Service / OCI workload |
| 🌿 | nixPI directory / host layout |
| 🪞 | Persona / identity |
| 💻 | OS / build / host operations |
| 📡 | Daemon / messaging / IPC |
| 🛡️ | Guardrails / trust / safety |
| 📓 | Episodes / journals / checklists |
| 🔍 | Audit / inspection |
| 🗂️ | Objects / memory / reference |
| 🚀 | Deploy / build / release |
| 🧭 | Navigation / entry points |
| 📚 | Documentation maps / references |
| 🔗 | Related links |

## 📚 Usage

- use emoji in section headers on root docs and `docs/*.md`
- keep emoji meaning stable across pages so the same symbol implies the same kind of content
- prefer emoji as visual anchors, not decoration
- keep one doc section per concern instead of mixing overview, procedure, and reference randomly

Excluded from this convention:

- `SKILL.md` files, because they are runtime-consumed instructions
- `core/pi/persona/` files, because they are loaded into Pi context

## 🔗 Related

- [../README.md](../README.md)
- [../AGENTS.md](../AGENTS.md)
- [service-architecture.md](service-architecture.md)
