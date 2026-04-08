# OVH NixOS Anywhere Deployment Design

## Summary

Add a first-class OVH deployment path to this repo using `nixos-anywhere` and
`disko`, while preserving the current NixPI steady-state operating model:

- fresh-machine install via OVH rescue mode
- installed NixOS defined by this repo
- canonical checkout at `/srv/nixpi` for day-2 operations
- canonical rebuild target at `/etc/nixos#nixos`

The first supported target should be a simple single-disk OVH VPS, but the repo
shape should allow multiple OVH machine profiles later.

## Problem

The repo currently has a strong post-install operating story:

- bootstrap or rebuild around `/srv/nixpi`
- keep `/etc/nixos#nixos` as the rebuild target
- operate the running system through normal NixOS and NixPI workflows

What it does not yet provide is a clear, repo-native fresh-install path for an
OVH VPS.

Right now, an operator wanting to deploy on OVH has to improvise:

- how to enter rescue mode
- how to install NixOS remotely
- how to express the disk layout declaratively
- how to reconcile initial provisioning with the existing `/srv/nixpi` model

That makes first deployment less reproducible than day-2 operation.

## Goals

- Add an explicit OVH VPS installation path to this repo.
- Use current official `nixos-anywhere` + `disko` patterns for install-time
  provisioning.
- Keep the first supported target simple: one OVH VPS, one disk, one reliable
  layout.
- Preserve the existing NixPI steady-state model after install:
  - `/srv/nixpi` as canonical checkout
  - `/etc/nixos#nixos` as canonical rebuild target
  - `nixpi-rebuild` / `nixpi-rebuild-pull` as normal day-2 tooling
- Structure the repo so additional OVH machine profiles can be added later
  without redesigning the whole deployment story.
- Add operator documentation that makes the OVH path straightforward to follow.

## Non-Goals

- Building a full multi-provider deployment framework in this change.
- Automatically discovering or guessing the install disk.
- Supporting every OVH storage/network topology in the first pass.
- Making day-2 operations depend on `nixos-anywhere`.
- Replacing the current bootstrap workflow for already NixOS-capable machines.
- Adding a fake full OVH integration test that tries to simulate the control
  panel or rescue email workflow.

## Constraints

- The deploy path must stay aligned with current official docs for:
  - `nixos-anywhere`
  - `disko`
  - OVH rescue mode
- The first implementation should optimize for reliability and clarity, not for
  maximum abstraction.
- Disk destruction must remain explicit and operator-directed.
- The existing canonical `/srv/nixpi` model must not be weakened.
- The diff should stay narrow and avoid turning deployment into a separate
  framework living beside the current repo conventions.

## Approach Options

### Option 1: Extend the current bootstrap-only path

Wrap the existing bootstrap flow in better OVH documentation and keep fresh
installs mostly manual.

Pros:

- smallest code diff
- preserves current tooling almost entirely

Cons:

- weak fresh-install story
- disk layout remains under-specified
- less reproducible than a declarative install path

### Option 2: Add a dedicated OVH + `nixos-anywhere` lane from this repo

Keep the current bootstrap and steady-state model, but add:

- an OVH-focused host profile
- a single-disk `disko` layout
- a thin `nixos-anywhere` deploy wrapper
- docs for OVH rescue mode and first deployment

Pros:

- best fit for the requested outcome
- reproducible and repo-native
- uses current official install tooling
- preserves current day-2 ergonomics

Cons:

- moderate repo change surface
- requires docs, flake wiring, and checks to stay in sync

### Option 3: Build a generic multi-provider deployment framework now

Introduce provider abstractions immediately for OVH and future platforms.

Pros:

- future-flexible on paper

Cons:

- over-engineered for the first supported deployment path
- adds abstraction before the concrete OVH workflow is proven
- delays a practical operator-focused result

## Recommended Approach

Implement Option 2.

This adds a first-class OVH installation path without disturbing the repo's
existing operational contract.

The resulting deployment lifecycle becomes:

1. boot the OVH VPS into rescue mode
2. run `nixos-anywhere` from this repo against the target
3. boot into the installed NixPI-backed NixOS system
4. operate the machine through `/srv/nixpi` and `/etc/nixos#nixos` like any
   other NixPI host

## Design

### 1. Deployment Architecture

Provisioning and operations should remain separate concerns.

Install-time flow:

- OVH rescue mode provides temporary SSH access
- `nixos-anywhere` installs NixOS from this repo
- `disko` provisions the target disk declaratively
- the installed system boots with NixPI enabled

Steady-state flow after first boot:

- `/srv/nixpi` is the canonical checkout
- `/etc/nixos#nixos` is the active rebuild target
- `sudo nixpi-rebuild` and `sudo nixpi-rebuild-pull` remain the standard
  update path

This separation keeps `nixos-anywhere` a day-0 tool instead of letting it leak
into routine host operation.

### 2. Repo Structure and Boundaries

Add the smallest set of repo artifacts needed for an explicit OVH path.

New files/modules:

- `core/os/hosts/ovh-vps.nix`
  - OVH-oriented host profile for remote VPS deployment
  - imports the existing NixPI module set
  - keeps headless/serial/EFI-friendly defaults where appropriate
- `core/os/disko/ovh-single-disk.nix`
  - declarative single-disk GPT layout
  - EFI system partition plus root filesystem
- `core/scripts/nixpi-deploy-ovh.sh`
  - thin wrapper around `nixos-anywhere`
  - forwards the explicit target host, disk device, and flake target
- operator docs for the OVH path

Existing files to extend:

- `flake.nix`
  - add `disko` and `nixos-anywhere` inputs
  - expose one or more OVH-oriented `nixosConfigurations`
  - package the deploy wrapper if that is the cleanest invocation surface
- `docs/install.md`
  - link to the OVH install path
- `docs/operations/quick-deploy.md`
  - distinguish fresh provisioning from bootstrap on an already NixOS-capable
    machine

Boundary to preserve:

- `nixos-anywhere` is for initial provisioning only
- `/srv/nixpi` + `/etc/nixos#nixos` remain the post-install operating model

### 3. First Supported Machine Shape

The initial supported OVH deployment should be intentionally narrow:

- one VPS
- one explicit target disk
- one simple partition scheme
- one host profile with sensible defaults

This should optimize for the most common OVH VPS case rather than trying to
cover RAID, multiple disks, exotic filesystems, or a broad fleet matrix on day
one.

### 4. Install Flow

Expected operator flow:

1. switch the OVH VPS to rescue mode in the OVH control panel
2. connect to the rescue environment over SSH
3. inspect the machine with `lsblk` if needed
4. run a repo command from the operator machine such as:

```bash
nix run .#nixpi-deploy-ovh -- \
  --target-host root@<server-ip> \
  --disk /dev/sda \
  --flake .#ovh-vps
```

The wrapper should invoke `nixos-anywhere` with the repo flake, the chosen host
configuration, and the explicit disk mapping.

Optional hardware report generation can be supported if it fits the repo cleanly,
but it should not complicate the first operator path.

### 5. Safety and Operator Ergonomics

The first version should favor explicitness over convenience:

- require the disk path explicitly
- document that installation is destructive
- document SSH host key rotation after reinstall
- keep first-login and rollback instructions in the runbook
- make the manual rescue-mode steps concrete and copy-pasteable

If the operator must make one important decision, it should be a visible one
(the target disk), not something the wrapper guesses.

### 6. Verification Shape

The deployment lane should be verified at three levels.

#### Flake and packaging verification

- the OVH host configuration evaluates successfully
- the `disko` layout evaluates successfully
- the deploy wrapper is syntax-checked and packaged cleanly

#### Repo-side regression checks

- tests or assertions confirm the OVH host target exists
- checks confirm the deploy wrapper uses the expected flake target and required
  flags
- docs and code references stay aligned on the canonical workflow

#### Operator documentation verification

- the OVH runbook includes rescue mode, install command, first login, and
  post-install rebuild guidance
- the docs explain the difference between fresh provisioning and the existing
  bootstrap path

A full simulated OVH rescue-mode integration environment is intentionally out of
scope for the first pass.

## Risks and Mitigations

### Risk: provisioning path drifts from the day-2 repo model

Mitigation:

- keep `/srv/nixpi` and `/etc/nixos#nixos` explicit in both code and docs
- treat `nixos-anywhere` as install-time only

### Risk: the first pass becomes too generic and slows delivery

Mitigation:

- support one simple OVH VPS shape first
- defer cross-provider abstraction until the OVH lane is proven

### Risk: disk handling is dangerous or unclear

Mitigation:

- require an explicit disk argument
- document destructive behavior prominently
- keep the first `disko` layout minimal and reviewable

### Risk: operator confusion between bootstrap and fresh install

Mitigation:

- clearly split docs into:
  - fresh install on OVH via rescue mode + `nixos-anywhere`
  - bootstrap on an already NixOS-capable machine

## Testing Strategy

- Add evaluation/build coverage for the new OVH host target.
- Add validation for the deploy wrapper command surface.
- Add narrow regression checks that the new deployment lane stays wired into the
  flake and docs.
- Verify that the existing post-install operational contract still points to
  `/srv/nixpi` and `/etc/nixos#nixos`.
- Manually validate the operator runbook wording against the current official
  `nixos-anywhere`, `disko`, and OVH rescue documentation.

## References

- NixOS Anywhere quickstart:
  `https://nix-community.github.io/nixos-anywhere/quickstart.html`
- NixOS Anywhere reference:
  `https://github.com/nix-community/nixos-anywhere/blob/main/docs/reference.md`
- NixOS Anywhere no-OS how-to:
  `https://github.com/nix-community/nixos-anywhere/blob/main/docs/howtos/no-os.md`
- Disko reference:
  `https://github.com/nix-community/disko/blob/master/docs/reference.md`
- OVH VPS rescue mode:
  `https://help.ovhcloud.com/csm/en-vps-rescue?id=kb_article_view&sysparm_article=KB0047656`
- OVH rescue support guide:
  `https://support.us.ovhcloud.com/hc/en-us/articles/360010553920-How-to-Recover-Your-VPS-in-Rescue-Mode`
