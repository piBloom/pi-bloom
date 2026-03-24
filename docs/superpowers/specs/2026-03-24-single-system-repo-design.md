# Single System Repo Design

**Date:** 2026-03-24
**Status:** Approved
**Supersedes:** `docs/superpowers/specs/2026-03-24-canonical-repo-worktree-design.md`

---

## Overview

NixPI should converge on one canonical local repository per machine at `/srv/nixpi`.
That repository is a full Git checkout cloned from a selected upstream repository or fork
during installation. It is the only supported place where generic NixPI code is edited,
committed, fetched, rebased, and pushed.

The goal is to eliminate the current multi-path model in which code and activation are
spread across `/home/$USER/nixpi`, `~/.nixpi/pi-nixpi`, `/var/lib/nixpi/pi-nixpi`, and
`/etc/nixos`. The resulting design keeps generic product code in one Git worktree while
keeping host-specific machine configuration separate and intentionally small.

This design is optimized for:

- one discoverable code location for humans and agents
- direct editing without proposal/apply clone ambiguity
- straightforward upstream or fork-based Git workflows
- a stable separation between generic product code and host-local machine data

---

## Approaches Considered

### Recommended: one system-owned repo at `/srv/nixpi` plus a tiny host layer

Store the canonical Git worktree at `/srv/nixpi`. Keep `/etc/nixos` as a minimal host-only
layer that imports the generic NixPI system definitions from `/srv/nixpi`.

Why this is the right fit:

- preserves one real code location
- keeps host-specific data out of the upstream-tracking repo
- stays understandable to NixOS operators
- avoids using `/etc` itself as a development worktree

### Alternative: make `/etc/nixos` the canonical Git repo

Use `/etc/nixos` as both the active host config and the upstream-tracking source repo.

Why not:

- Git operations in `/etc` are awkward
- host-local state tends to accumulate in the same tree as shared code
- poorer contributor ergonomics for forks and upstream pushes

### Alternative: canonical user-owned repo in `/home/$USER/nixpi`

Use a single checkout in the primary user’s home directory and treat that as the source of
truth.

Why not:

- still leaves activation split from the system’s conventional config entrypoint
- weaker operational boundary for installed systems
- less clean if the goal is one machine-level code location rather than one user workspace

---

## Architecture

Every installation has exactly one supported NixPI Git worktree:

- canonical repo path: `/srv/nixpi`

That repository is a full Git checkout whose `origin` must match the configured install
remote exactly. NixPI should not support alternate working-repo locations for normal
operation.

The machine also has a separate host-specific configuration layer:

- host layer path: `/etc/nixos`

`/etc/nixos` is not a repo, not a second codebase, and not a general development workspace.
It exists only to hold machine-local NixOS facts and a minimal import shim that composes the
host with generic code from `/srv/nixpi`.

The repo and host layer have distinct responsibilities:

- `/srv/nixpi` contains generic NixPI code, infrastructure logic, modules, tooling, docs,
  and tests
- `/etc/nixos` contains only host-local machine configuration, hardware information, and
  references to secrets or secret-management inputs

Secrets themselves should not live in `/srv/nixpi`, and `/etc/nixos` should carry references
to secrets rather than secret payloads.

The local-path policy is strict:

- `/srv/nixpi` is the only supported Git worktree
- `/home/$USER/nixpi`, `~/.nixpi/pi-nixpi`, and `/var/lib/nixpi/pi-nixpi` are unsupported
  as source-of-truth repos
- `/etc/nixos` remains a host layer only and must not be treated as the main repo

The branch policy is intentionally split between development and activation:

- humans and agents may use local feature branches in `/srv/nixpi`
- the repo path remains canonical even when the active branch is not `main`
- supported rebuilds and activation run only from `main`
- rebuild tooling should fail clearly if `/srv/nixpi` is not currently on `main`

---

## Components

### Installer and bootstrap

Installation or first boot must create `/srv/nixpi` as a full Git checkout from a selected
remote and default branch. Bootstrap must fail hard if it cannot create or validate that
checkout.

Bootstrap must also write a minimal `/etc/nixos` host layer that imports generic NixPI
configuration from `/srv/nixpi`.

### Canonical repo path API

One shared API should define the canonical repo path as `/srv/nixpi`. Any runtime code that
needs the repo must consume that API instead of hardcoding or discovering legacy paths.

### Host-layer generation

The `/etc/nixos` shim should remain intentionally small and generic. Host-specific machine
configuration should be the only content written there, along with imports that connect the
host to the generic code in `/srv/nixpi`.

The host layer should be flake-based and NixOS-native:

- `/etc/nixos/flake.nix` is the stable activation entrypoint
- `/etc/nixos/flake.nix` stays intentionally small
- `/etc/nixos` does not carry an independent `flake.lock`
- `/srv/nixpi` remains the source of lock state for generic code

### Rebuild and update flows

Operators, scripts, and helpers edit code in `/srv/nixpi`, but activation proceeds through
the stable host layer in `/etc/nixos`. This keeps the NixOS entrypoint conventional while
leaving the real code in one canonical repo.

The supported rebuild shape is:

- edit and branch in `/srv/nixpi`
- switch back to `main` for supported rebuilds
- activate through `/etc/nixos/flake.nix`, which imports from `/srv/nixpi`

### Docs and agent policy

Docs, skills, and agent instructions must converge on the same invariant:

- edit `/srv/nixpi`
- run Git in `/srv/nixpi`
- treat `/etc/nixos` as host-only
- never use home or proposal/apply clones as the source-of-truth repo

---

## Data Flow

On installation:

1. choose or receive the Git remote URL and default branch
2. clone the repo into `/srv/nixpi`
3. validate that `/srv/nixpi` is a Git repo with the expected `origin`
4. generate a tiny `/etc/nixos` host layer
5. activate the system through the `/etc/nixos` entrypoint, which imports from `/srv/nixpi`

During normal operation:

1. humans and agents edit code directly in `/srv/nixpi`
2. Git fetch, rebase, commit, and push all happen in `/srv/nixpi`
3. host-local machine config remains in `/etc/nixos`
4. rebuilds evaluate the host layer, which composes local machine data with generic code from
   `/srv/nixpi`
5. supported rebuilds require `/srv/nixpi` to be on `main`

For upstream/fork workflows:

1. install chooses an upstream repo or a fork as the canonical `origin`
2. the local repo path remains `/srv/nixpi`
3. additional remotes such as `upstream` are allowed
4. contributions are pushed from that one checkout

The invariant is simple: one repo path, one Git workflow, one host layer.

---

## Error Handling

Because this design is intentionally strict, failures should be explicit.

Installation or runtime should stop with a clear error when:

1. `/srv/nixpi` does not exist when required
2. `/srv/nixpi` exists but is not a Git repository
3. `/srv/nixpi` points at the wrong `origin`
4. installation cannot create `/srv/nixpi` exactly
5. rebuild tooling is invoked while `/srv/nixpi` is not on `main`
6. code attempts to use `/home/$USER/nixpi`, `~/.nixpi/pi-nixpi`, or
   `/var/lib/nixpi/pi-nixpi` as the working repo
7. code tries to treat `/etc/nixos` as the canonical Git worktree

The simplest supported behavior is fail-fast, not auto-repair. If an install or machine
already contains an unexpected repo at `/srv/nixpi`, the operator must correct it explicitly.

---

## Permissions

The design requires direct editing in `/srv/nixpi`, so permissions must support normal
operator and agent workflows without introducing a second writable clone.

The cleanest operational model is:

- the primary user owns the working tree in `/srv/nixpi`
- root retains full access through normal system privileges
- rebuilds and activation still use normal root privileges when required
- broker mediation remains optional for privileged operations, not mandatory for normal code
  edits

This keeps the single-repo model intact without making Git activity depend on broker health.

---

## Migration

Existing docs and runtime references to `/home/$USER/nixpi`, `~/.nixpi/pi-nixpi`, and
`/var/lib/nixpi/pi-nixpi` must be updated or removed.

Existing installations should migrate explicitly rather than through hidden compatibility
logic. A migration path can be documented separately, but the product should not preserve the
old multi-repo model as a supported steady state.

---

## Testing

Testing should prove that the single-repo invariant is real across install, runtime behavior,
and operator workflows.

### Installer and bootstrap tests

Verify:

- successful clone into `/srv/nixpi`
- failure when `/srv/nixpi` already exists but is not a Git repo
- acceptance only when an existing `/srv/nixpi` exactly matches expected `origin`
- failure when the remote is wrong
- successful generation of a minimal `/etc/nixos` host layer

### Runtime and operations tests

Verify:

- path resolution returns `/srv/nixpi`
- rebuild and update helpers use the `/etc/nixos` host layer and import generic code from
  `/srv/nixpi`
- rebuild tooling fails clearly when `/srv/nixpi` is not on `main`
- docs and agent guidance point to `/srv/nixpi`
- legacy repo paths are rejected clearly

### Boundary tests

Verify:

- host-specific data remains outside `/srv/nixpi`
- `/etc/nixos` stays small and host-only
- `/etc/nixos` does not become a second Git worktree
