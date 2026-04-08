# Declarative NixOS Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the remaining imperative first-boot, privilege, socket, and home-state mutation flows with standard declarative NixOS patterns.

**Architecture:** The cleanup should move the system from runtime shell mutation toward explicit NixOS configuration states. The largest shift is removing first-boot repo/flake seeding from the convergence path, then collapsing dynamic marker-file behavior into declarative bootstrap vs steady-state configuration, and finally converting broker/app/shell runtime setup to native systemd, tmpfiles, sudo/polkit, and shell-module patterns.

**Tech Stack:** Nix flakes, NixOS modules, systemd services/sockets, systemd tmpfiles, sudo/polkit, nixos-anywhere, disko, NixOS VM tests

---

## Requirements Summary

- Eliminate runtime generation of `/etc/nixos/flake.nix` from the normal install path.
- Eliminate first-boot `git clone`/`chown` convergence requirements for a working host.
- Replace home-directory marker-file gating with declarative configuration states or system-owned state.
- Replace broker socket chmod/chown logic with native systemd socket ownership.
- Replace shell/home activation mutations with declarative shell/session configuration.
- Keep operator ergonomics clear: standard rebuild path, clear bootstrap story, preserved test coverage.

## Acceptance Criteria

1. No production NixOS module depends on generating `/etc/nixos/flake.nix` at boot.
2. No production NixOS module depends on cloning `/srv/nixpi` at boot to achieve a working system.
3. SSH/bootstrap privilege behavior is controlled by explicit NixOS config, not `~/.nixpi/wizard-state/system-ready`.
4. The broker socket is provided by `systemd.sockets`, with declarative owner/group/mode.
5. No production activation script mutates `~/.bashrc`, `~/.bash_profile`, or dynamic sudoers fragments.
6. NixOS VM tests cover bootstrap/install, runtime, broker, and operator workflow after the cleanup.
7. Docs describe the new canonical declarative flow without referring to removed imperative steps.

## Risks and Mitigations

- **Risk:** Removing install finalization breaks the current OVH deployment path.
  - **Mitigation:** land the new declarative host install path behind tests first; keep compatibility temporarily only if tests require an intermediate step.
- **Risk:** Replacing marker-file gates changes operator onboarding semantics.
  - **Mitigation:** model bootstrap explicitly as config, document intended transition, and prove it in VM tests.
- **Risk:** Broker socket activation changes command timing.
  - **Mitigation:** add a focused broker test for service/socket startup and permission semantics.
- **Risk:** Removing `/srv/nixpi` convergence assumptions breaks wrapper commands/docs.
  - **Mitigation:** separate “operator convenience checkout” from “system source of truth” in both code and docs.

## Verification Steps

- `nix flake check --no-build`
- `nix build .#checks.x86_64-linux.config --no-link`
- `nix build .#checks.x86_64-linux.nixos-smoke --no-link`
- `nix build .#checks.x86_64-linux.nixos-full --no-link`
- Targeted VM checks for install/bootstrap/runtime/broker/operator docs assertions as each task lands

---

### Task 1: Freeze the target architecture in tests and docs

**Files:**
- Modify: `tests/integration/standards-guard.test.ts`
- Modify: `docs/install.md`
- Modify: `docs/operations/quick-deploy.md`
- Modify: `docs/operations/first-boot-setup.md`
- Modify: `docs/architecture/runtime-flows.md`
- Modify: `README.md`

- [ ] **Step 1: Add failing guard assertions for the imperative patterns being removed**

Add or update standards/docs assertions so the repo fails if production guidance still depends on:
- `git clone` in install convergence
- generated `/etc/nixos/flake.nix`
- `system-ready` marker-file gating as the primary control path
- activation-script shell dotfile seeding

- [ ] **Step 2: Run the guard tests to verify they fail**

Run: `npm test -- --run tests/integration/standards-guard.test.ts`
Expected: FAIL with assertions still matching old install-finalize / shell-mutation behavior.

- [ ] **Step 3: Rewrite docs to describe the intended declarative end state**

Describe the new target flow in prose before changing modules:
- install directly into the final host config
- no first-boot flake generation
- bootstrap/steady-state controlled by NixOS config, not user-home markers
- operator rebuild path and repo semantics explicitly separated

- [ ] **Step 4: Re-run the guard tests**

Run: `npm test -- --run tests/integration/standards-guard.test.ts`
Expected: PASS for doc/guard assertions.

---

### Task 2: Remove install-finalize as a convergence requirement

**Files:**
- Modify: `core/os/modules/install-finalize.nix`
- Modify: `core/os/hosts/vps.nix`
- Modify: `core/os/hosts/ovh-vps.nix`
- Modify: `core/scripts/nixpi-deploy-ovh.sh`
- Modify: `flake.nix`
- Modify: `tests/nixos/nixpi-firstboot.nix`
- Modify: `tests/nixos/nixpi-system-flake.nix`
- Modify: `tests/nixos/default.nix`
- Delete or stop referencing: `core/scripts/nixpi-install-finalize.sh`
- Delete or stop referencing: `core/scripts/nixpi-init-system-flake.sh`

- [ ] **Step 1: Change the VM tests so they encode the desired declarative install path**

Update the install/system-flake tests to prove:
- the host boots without a first-boot clone/generate step
- `/etc/nixos/flake.nix` is not created at runtime by NixPI
- the installed host configuration is already complete when the machine boots

- [ ] **Step 2: Run the targeted NixOS tests to verify they fail**

Run: `nix build .#checks.x86_64-linux.nixpi-firstboot .#checks.x86_64-linux.nixpi-system-flake --no-link`
Expected: FAIL because the current tests/modules still assume install-finalize.

- [ ] **Step 3: Refactor the host/install path to use direct declarative installation**

Implementation targets:
- make `nixos-anywhere` install the final host configuration directly
- stop wiring `install-finalize.nix` into the standard module sets
- stop treating generated `/etc/nixos/flake.nix` as part of the supported architecture
- if `/srv/nixpi` remains, make it an operator convenience path rather than a boot-time requirement

- [ ] **Step 4: Remove obsolete scripts and checks**

Delete or unhook:
- `core/scripts/nixpi-install-finalize.sh`
- `core/scripts/nixpi-init-system-flake.sh`
- flake checks whose purpose is alignment with generated-flake behavior

- [ ] **Step 5: Re-run targeted tests and flake eval**

Run: `nix build .#checks.x86_64-linux.nixpi-firstboot .#checks.x86_64-linux.nixpi-system-flake .#checks.x86_64-linux.config --no-link`
Expected: PASS.

---

### Task 3: Replace marker-file bootstrap gating with declarative system states

**Files:**
- Modify: `core/os/modules/network.nix`
- Modify: `core/os/modules/broker.nix`
- Modify: `core/os/modules/options.nix`
- Create or modify: a dedicated bootstrap/steady-state options module under `core/os/modules/options/`
- Modify: `tests/nixos/nixpi-post-setup-lockdown.nix`
- Modify: `tests/nixos/nixpi-security.nix`
- Modify: `tests/nixos/nixpi-e2e.nix`
- Delete or stop referencing: `core/scripts/nixpi-setup-apply.sh`
- Delete or stop referencing: `core/os/pkgs/nixpi-setup-apply/default.nix`

- [ ] **Step 1: Rewrite the tests to stop depending on `~/.nixpi/wizard-state/system-ready`**

Make the tests describe explicit config semantics instead:
- bootstrap mode leaves SSH/bootstrap privileges enabled
- steady-state mode removes them
- state transitions occur through config selection/rebuild, not marker-file touches

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run: `nix build .#checks.x86_64-linux.nixpi-post-setup-lockdown .#checks.x86_64-linux.nixpi-security .#checks.x86_64-linux.nixpi-e2e --no-link`
Expected: FAIL because current modules/scripts still use marker-file gating.

- [ ] **Step 3: Add explicit bootstrap-state options**

Introduce an option set such as:
- `nixpi.bootstrap.enable`
- `nixpi.bootstrap.ssh.enable`
- `nixpi.bootstrap.temporaryAdmin.enable`

Then drive SSH/sudo behavior directly from those options.

- [ ] **Step 4: Remove the imperative setup-apply path**

Delete the `nixpi-setup-apply` command and any package/module references if no longer needed. If a transition helper is still temporarily required, keep it as a thin rebuild trigger only—not a state-mutation script.

- [ ] **Step 5: Re-run the targeted tests**

Run: `nix build .#checks.x86_64-linux.nixpi-post-setup-lockdown .#checks.x86_64-linux.nixpi-security .#checks.x86_64-linux.nixpi-e2e --no-link`
Expected: PASS.

---

### Task 4: Convert the broker to native systemd socket activation

**Files:**
- Modify: `core/os/modules/broker.nix`
- Modify: `core/os/broker.ts`
- Modify: `tests/os/broker.test.ts`
- Modify: `tests/nixos/nixpi-broker.nix`

- [ ] **Step 1: Add failing tests for socket-activated behavior**

Update broker tests so the desired state is:
- `systemd.sockets.nixpi-broker` owns the socket path
- no runtime `chown`/`chmod` logic is needed in `broker.ts`
- the broker service can start on demand via the socket

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run: `npm test -- --run tests/os/broker.test.ts && nix build .#checks.x86_64-linux.nixpi-broker --no-link`
Expected: FAIL because the broker currently creates and fixes the socket itself.

- [ ] **Step 3: Implement native socket activation**

Refactor toward:
- `systemd.sockets.nixpi-broker.listenStreams = [ "/run/nixpi-broker/broker.sock" ]`
- declarative socket owner/group/mode
- broker process reads the inherited socket or standard socket-activation contract
- remove `setSocketPermissions` and path-precreation logic from the runtime where no longer needed

- [ ] **Step 4: Re-run the targeted tests**

Run: `npm test -- --run tests/os/broker.test.ts && nix build .#checks.x86_64-linux.nixpi-broker --no-link`
Expected: PASS.

---

### Task 5: Remove home-directory mutation from app and shell modules

**Files:**
- Modify: `core/os/modules/app.nix`
- Modify: `core/os/modules/shell.nix`
- Modify: `core/os/modules/options/agent.nix`
- Modify: `tests/nixos/nixpi-runtime.nix`
- Modify: `tests/nixos/nixpi-modular-services.nix`
- Modify: `tests/nixos/nixpi-firstboot.nix`

- [ ] **Step 1: Update runtime tests to encode declarative expectations**

Target behavior:
- no activation script copies `.bashrc`/`.bash_profile`
- `~/.pi` setup is reduced to declarative dirs/files/symlinks where still required
- app defaults come from store-backed config or tmpfiles, not imperative chown/seed loops

- [ ] **Step 2: Run targeted runtime tests to verify they fail**

Run: `nix build .#checks.x86_64-linux.nixpi-runtime .#checks.x86_64-linux.nixpi-modular-services .#checks.x86_64-linux.nixpi-firstboot --no-link`
Expected: FAIL while the old activation/service setup is still present.

- [ ] **Step 3: Replace shell mutation with native shell configuration**

Refactor `shell.nix` toward:
- `environment.sessionVariables`
- `programs.bash.interactiveShellInit`
- `programs.bash.loginShellInit`
- optional `/etc/skel` only if truly needed for new-home defaults

- [ ] **Step 4: Minimize app setup to tmpfiles/store-backed defaults**

Refactor `app.nix` toward:
- declarative tmpfiles for directories/symlinks
- immutable default settings path or generated environment variable
- removal of recursive `/srv/nixpi` and `~/.pi` ownership repair in oneshot service

- [ ] **Step 5: Re-run targeted runtime tests**

Run: `nix build .#checks.x86_64-linux.nixpi-runtime .#checks.x86_64-linux.nixpi-modular-services .#checks.x86_64-linux.nixpi-firstboot --no-link`
Expected: PASS.

---

### Task 6: Reframe `/srv/nixpi` as operator workflow, not system convergence

**Files:**
- Modify: `core/scripts/nixpi-rebuild-pull.sh`
- Modify: `core/os/modules/tooling.nix`
- Modify: `core/pi/extensions/os/index.ts`
- Modify: `core/pi/extensions/os/actions.ts`
- Modify: `README.md`
- Modify: `docs/install.md`
- Modify: `docs/operations/quick-deploy.md`
- Modify: `docs/operations/first-boot-setup.md`
- Modify: `docs/reference/infrastructure.md`
- Modify: `tests/extensions/os.test.ts`
- Modify: `tests/integration/standards-guard.test.ts`

- [ ] **Step 1: Adjust operator and extension tests around the new source-of-truth model**

Decide and encode one of these explicitly:
- `/srv/nixpi` remains a convenience checkout only, while the real system source is the installed flake host config; or
- `/srv/nixpi` remains canonical for operators but is no longer required for successful boot/install convergence.

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run: `npm test -- --run tests/extensions/os.test.ts tests/integration/standards-guard.test.ts`
Expected: FAIL where text/commands still assume mutable checkout semantics as convergence-critical.

- [ ] **Step 3: Narrow or replace `nixpi-rebuild-pull` semantics**

Refactor the wrapper so it is clearly an operator sync helper, not a hidden system-state requirement. Remove any implication that hard-resetting `/srv/nixpi` is how the OS becomes valid.

- [ ] **Step 4: Re-run targeted tests**

Run: `npm test -- --run tests/extensions/os.test.ts tests/integration/standards-guard.test.ts`
Expected: PASS.

---

### Task 7: Final verification and cleanup sweep

**Files:**
- Modify any remaining touched files from previous tasks
- Update: `tests/nixos/README.md`
- Update: `docs/reference/infrastructure.md`

- [ ] **Step 1: Remove dead code and stale assertions**

Delete unused packages, scripts, check lanes, docs references, and test helpers left behind by the migration.

- [ ] **Step 2: Run JavaScript/unit/integration verification**

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Run flake evaluation and targeted Nix builds**

Run: `nix flake check --no-build`
Expected: PASS.

- [ ] **Step 4: Run full NixOS verification lanes**

Run: `nix build .#checks.x86_64-linux.nixos-smoke .#checks.x86_64-linux.nixos-full --no-link`
Expected: PASS.

- [ ] **Step 5: Document remaining intentional imperatives**

If any imperative path remains by design, record it explicitly in docs/reference with why the declarative alternative was rejected.

