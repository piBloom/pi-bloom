# Canonical Rebuild Workflow Design

## Summary

Make the canonical `/srv/nixpi` checkout more explicit in both tooling and Pi’s
operator guidance.

The new workflow should provide:

- `nixpi-rebuild` as the steady-state rebuild command that works from anywhere
- `nixpi-rebuild-pull [branch-or-ref]` as the opinionated update-then-rebuild
  command for the canonical checkout
- Pi-facing awareness that `/srv/nixpi` is the source of truth for the running
  system configuration

## Problem

The current system already intends `/srv/nixpi` to be the canonical checkout,
but that model is not surfaced clearly enough in operator ergonomics.

Observed friction:

- operators can forget that `/srv/nixpi` is the repo actually used for rebuilds
- updating the canonical checkout requires manual `sudo git ...` steps
- rebuild and update are split across multiple commands
- Pi does not consistently explain that `/srv/nixpi` is the OS source checkout
  and rebuild source of truth

This makes routine maintenance more error-prone than it needs to be.

## Goals

- Keep `/srv/nixpi` as the single canonical managed checkout.
- Preserve `nixpi-rebuild` as the standard steady-state rebuild wrapper.
- Add `nixpi-rebuild-pull [branch-or-ref]` for the common update-and-apply flow.
- Ensure the wrappers can be run from any current working directory.
- Make Pi explicitly aware that `/srv/nixpi` is the canonical OS source tree.
- Reinforce the canonical repo model in user-facing command output and docs.

## Non-Goals

- Supporting arbitrary non-canonical repo locations as first-class rebuild
  targets.
- Turning `nixpi-rebuild-pull` into a general-purpose Git frontend.
- Replacing `/etc/nixos#nixos` as the canonical rebuild target.
- Building a full branch management workflow beyond “update canonical checkout,
  then rebuild.”

## Constraints

- `/srv/nixpi` remains the authoritative repo used for system updates.
- Rebuilds must still flow through `/etc/nixos#nixos`.
- The pull wrapper must handle the current root-owned `/srv/nixpi/.git`
  metadata model cleanly.
- Pi/operator guidance must stay aligned with the actual code path.
- The diff should stay narrow and avoid unrelated repo-management features.

## Approach Options

### Option 1: Improve docs only

Pros:

- smallest change
- no command-surface expansion

Cons:

- does not remove the repetitive manual `sudo git ...` workflow
- keeps update and rebuild as separate operator steps
- does not make Pi operationally smarter on its own

### Option 2: Add one canonical pull-and-rebuild wrapper plus explicit Pi awareness

Pros:

- matches the actual operator workflow
- keeps the system opinionated and simple
- reduces repeated Git/sudo mistakes
- improves both tooling and assistant guidance

Cons:

- adds another global command to maintain
- requires tests and docs to stay synchronized

### Option 3: Generalize rebuild tooling around arbitrary repo paths

Pros:

- more flexible for advanced operators

Cons:

- weakens the canonical `/srv/nixpi` model
- adds branching and state complexity
- solves a broader problem than requested

## Recommended Approach

Implement Option 2.

This keeps the operational model explicit:

- `/srv/nixpi` is the canonical checkout
- `/etc/nixos#nixos` is the canonical rebuild target
- `nixpi-rebuild-pull` is the one supported “update then apply” wrapper

It improves ergonomics without diluting the source-of-truth model.

## Design

### 1. Command Surface

Keep:

- `nixpi-rebuild`

Add:

- `nixpi-rebuild-pull [branch-or-ref]`

Expected behavior:

- `nixpi-rebuild`
  - can be run from any directory
  - always rebuilds using `nixos-rebuild switch --flake /etc/nixos#nixos --impure`
- `nixpi-rebuild-pull`
  - can be run from any directory
  - updates `/srv/nixpi`
  - defaults to `origin/main`
  - accepts an optional branch/ref argument
  - then invokes the same canonical rebuild path as `nixpi-rebuild`

### 2. Canonical Repo Semantics

The wrapper should treat `/srv/nixpi` as the only managed checkout.

That means:

- it should not depend on the caller’s current working directory
- it should not pull some arbitrary local repo
- it should not silently switch to another checkout location

The wrapper should perform the Git update against the canonical checkout
directly, even when `/srv/nixpi/.git` is root-owned.

### 3. Branch / Ref Handling

Default behavior:

- `nixpi-rebuild-pull`
  - update from `origin/main`

Optional behavior:

- `nixpi-rebuild-pull some-branch`
  - update the canonical checkout to the requested branch/ref

The interface should stay narrow and predictable. One optional positional
argument is enough.

### 4. Pi Awareness

Pi should know and explain that:

- `/srv/nixpi` is the canonical system source checkout
- it is the repo used for steady-state updates
- rebuilds operate through `/etc/nixos#nixos`
- `nixpi-rebuild` is the standard rebuild command
- `nixpi-rebuild-pull` is the standard update-then-rebuild command

This awareness should live in both:

- prompt/persona/skill surfaces
- operator-facing tool and wrapper messaging

### 5. Operator Messaging

Bootstrap and steady-state guidance should reinforce:

- “the canonical repo lives at `/srv/nixpi`”
- “use `sudo nixpi-rebuild` for rebuilds”
- “use `sudo nixpi-rebuild-pull [branch]` to update the canonical checkout and
  rebuild”

This should reduce ambiguity about where updates happen and which checkout
matters.

### 6. Verification

The change is complete when all of the following are true:

1. `nixpi-rebuild` remains globally installed and still targets
   `/etc/nixos#nixos`.
2. `nixpi-rebuild-pull` is globally installed and defaults to pulling the
   canonical `/srv/nixpi` checkout from `origin/main`.
3. `nixpi-rebuild-pull <branch>` accepts an explicit branch/ref argument.
4. Pi-facing text explicitly describes `/srv/nixpi` as the canonical OS source
   checkout.
5. Operator docs mention the canonical `/srv/nixpi` workflow and the new
   pull-and-rebuild command.

## Risks and Mitigations

### Risk: wrapper semantics drift from docs or Pi guidance

Mitigation:

- add tests/guards for command behavior and text references

### Risk: branch handling becomes ambiguous

Mitigation:

- keep the interface to one optional positional argument
- default clearly to `main`

### Risk: operators assume arbitrary repo locations are supported

Mitigation:

- repeatedly document `/srv/nixpi` as the only canonical managed checkout

## Testing Strategy

- Write tests first for the new wrapper and the canonical `/srv/nixpi` messaging.
- Verify the existing `nixpi-rebuild` wrapper still points to `/etc/nixos#nixos`.
- Verify the new wrapper defaults to `origin/main` and supports an override arg.
- Sweep Pi-facing text and docs for the canonical repo explanation.
