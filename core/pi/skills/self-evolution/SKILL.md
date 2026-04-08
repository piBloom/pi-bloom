---
name: self-evolution
description: Detect improvement opportunities and propose system changes through a structured evolution workflow
---

# Self-Evolution Skill

Use this skill when NixPI detects a capability gap or the user requests a system change.

## Choosing the Right Mechanism

When extending capabilities, prefer the lightest option: **Skill → Extension → Service**.

| Need | Mechanism | Example |
|------|-----------|---------|
| Pi needs knowledge or a procedure | **Skill** — create a SKILL.md | Meal planning guide, API reference |
| Pi needs commands, tools, or session hooks | **Extension** — TypeScript (requires PR) | New Pi command, event handler |
| Standalone workload needing isolation | **Service** — Container (Podman Quadlet) | ML model, messaging bridge, VPN |

## Evolution Workflow

1. **Detect**: Recognize a capability gap or improvement opportunity
2. **Propose**: Create an evolution object using `memory_create`
3. **Plan**: Design the implementation approach
4. **Implement**: Make the changes locally in the repo or NixPI directory
5. **Verify**: Test and validate
6. **Review**: Have the human inspect the resulting diff before any external publish

## Available Tools

### Object Store (for tracking)
- `memory_create` — Create evolution tracking objects
- `memory_read` — Read evolution details
- `memory_search` — Find existing evolutions

## Evolution Object Fields

- `status`: proposed | planning | implementing | reviewing | approved | applied | rejected
- `risk`: low | medium | high
- `area`: objects | persona | skills | services | system

## Safety Rules

- All system changes require user approval before applying
- Always test changes before deploying
- Document what each evolution changes and why
- Keep a rollback plan for NixOS and service changes
- Persona changes are tracked as evolution objects — never modify persona files directly

## Code Evolution Workflow

When NixPI identifies a code-level fix or improvement to its own OS/extensions, it should prepare the change locally for human review.

**Running host source of truth**: installed `/etc/nixos` flake
**Conventional on-host operator checkout**: `/srv/nixpi` (optional)
**Optional operator sync command**: `sudo nixpi-rebuild-pull [branch]`
**Canonical rebuild command**: `sudo nixpi-rebuild`

### Process

1. **Detect + Plan**
   - Describe the issue and proposed fix in plain language.
2. **Implement locally**
   - Edit the repo checkout under review. On a deployed host, `/srv/nixpi` is only the conventional operator checkout if the human chose to keep it.
3. **Validate**
   - Run local checks such as `npm run build`, `npm run test:unit`, `npm run test:integration`, and `npm run test:e2e` when relevant.
4. **Prepare review**
   - Summarize the diff and the validation results.
5. **Human review**
   - The user reviews the local diff in VS Code or another editor.
6. **External publish**
   - Commit, push, PR creation, merge, and rollout happen outside NixPI.

### Safety

- NixPI prepares local proposals only
- remote publish is always human- or controller-driven
- rollout is always external to the node

## Adding A Built-In Service

When NixPI identifies a need for a new user-facing service, treat it as base NixOS work rather than a packaged runtime feature.

Use direct repo edits in the OS modules, add a bundled skill only if Pi needs service-specific operating guidance, validate locally, and hand the resulting diff to the human for review and external publish.
