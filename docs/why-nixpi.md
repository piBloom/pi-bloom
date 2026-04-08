---
title: Why NixPI
description: Why this project exists, what it optimizes for, and how it differs from a generic AI assistant stack.
---

<SectionHeading
  label="Positioning"
  title="A self-hosted AI operating model, not a chat wrapper"
  lede="NixPI exists to turn a machine into a durable personal AI environment: one user, one inspectable system, one place where memory, automation, and host control can live together."
/>

<PresentationBand
  eyebrow="Core thesis"
  title="The computer should feel like an inhabited system"
  lede="Most AI products stop at prompts, tabs, or SaaS workflows. NixPI is opinionated in a different direction: the assistant belongs inside the machine, carries durable memory, and operates through files, services, and messaging surfaces you can inspect."
>

<div class="signal-grid">
  <div class="signal-card">
    <strong>Single-user by design</strong>
    It is built for one operator instead of flattening every workflow into a shared multi-tenant product shape.
  </div>
  <div class="signal-card">
    <strong>Inspectable memory</strong>
    Durable memory stays in Markdown under <code>~/nixpi/Objects/</code>, not inside an opaque hosted database.
  </div>
  <div class="signal-card">
    <strong>Agent as system citizen</strong>
    Pi is wired into NixOS workflows, local services, and a resident local runtime instead of living only in a browser session.
  </div>
  <div class="signal-card">
    <strong>Minimal base, extensible edge</strong>
    The default runtime stays small so the operator can evolve the system through Pi instead of inheriting a large fixed surface.
  </div>
</div>

</PresentationBand>

<SectionHeading
  label="Design pressures"
  title="The project is shaped by four constraints"
  lede="These constraints explain both the technical architecture and the visual voice the site should communicate."
/>

| Constraint | What it means in practice |
| --- | --- |
| Self-hosted first | The system should remain understandable, operable, and private on hardware you control. |
| Deterministic base | NixOS provides reproducible system state and a clean proposal workflow for change. |
| Durable assistant state | Memory should survive sessions and stay editable without proprietary tooling. |
| Human review over silent autonomy | System changes should remain inspectable and reviewable instead of disappearing into background automation. |

<PresentationBand
  eyebrow="What ships"
  title="NixPI already behaves like a small operating environment"
  lede="Today's project is not just a concept page. It already combines provisioning, agent runtime, memory, and a private communication surface into one working stack."
>

- NixOS modules for provisioning and service composition
- A resident daemon that keeps Pi available outside terminal sessions
- A built-in Pi terminal surface for browser, SSH, and local-shell operation
- Markdown-native durable memory and append-only episodic capture
- First-boot setup flows and proposal-based local system evolution

</PresentationBand>

## Read the system through its layers

| Layer | Role |
| --- | --- |
| NixOS | Provisions the base system, networking, services, and trusted boundaries |
| Daemon | Keeps the assistant available in a persistent local runtime |
| Extensions | Exposes tool surfaces for memory, host operations, and project workflows |
| Memory | Stores durable objects and episodes in files the operator can read directly |

## Where to go next

- Start with [Install](./install) if you want to try the system.
- Read [Architecture](./architecture/) for subsystem boundaries.
- Read [Getting Started](./getting-started/) if you want the maintainer-oriented path.
