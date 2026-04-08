# TTYD + Pi Terminal Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the chat-first browser surface with a ttyd-first Pi terminal surface, and move setup-vs-normal gating into Pi behavior keyed off `~/.nixpi/wizard-state/system-ready`.

**Architecture:** Remove the browser chat path from the primary product surface, route `/` to ttyd, and introduce a small terminal bootstrap wrapper that makes ttyd feel Pi-first without building a second UI. Keep setup guidance inside Pi extensions/skills so ttyd, SSH, and local shells share the same semantics.

**Tech Stack:** NixOS modules, systemd, nginx, ttyd, TypeScript Pi extensions, Vitest, NixOS tests

---

### File structure map

**Primary files likely to change**
- Modify: `core/os/modules/service-surface.nix` — route `/` to ttyd instead of the chat server
- Modify: `core/os/modules/ttyd.nix` — launch ttyd through a dedicated bootstrap wrapper instead of raw bash
- Modify: `core/os/modules/app.nix` — remove `nixpi-chat` service wiring if no longer needed and keep Pi runtime setup only
- Create: `core/scripts/nixpi-terminal-bootstrap.sh` — explicit ttyd/session entry wrapper for Pi-first terminal startup
- Create: `core/os/pkgs/nixpi-terminal-bootstrap/default.nix` — package the bootstrap script declaratively
- Modify: `core/os/pkgs/app/default.nix` — stop packaging chat frontend artifacts if no longer used
- Modify: `core/pi/extensions/persona/actions.ts` and/or `core/pi/extensions/persona/index.ts` — redefine setup gating semantics around `system-ready`
- Modify: `core/pi/skills/first-boot/SKILL.md` — replace old web-chat assumptions with terminal-first Pi guidance
- Modify: `README.md`, `docs/operations/quick-deploy.md`, `docs/operations/first-boot-setup.md` — update operator story from chat+terminal to Pi-in-terminal
- Delete: legacy browser-runtime source and tests
- Modify: `tests/nixos/nixpi-chat.nix` (likely rename/scope change), `tests/nixos/nixpi-firstboot.nix`, `tests/nixos/nixpi-vps-bootstrap.nix`, `tests/nixos/nixpi-e2e.nix` — assert ttyd-first surface and setup gating

---

### Task 1: Lock the new product surface with failing tests

**Files:**
- Modify or replace the legacy browser-runtime test coverage
- Modify: `tests/nixos/nixpi-firstboot.nix`
- Modify: `tests/nixos/nixpi-chat.nix`
- Test: focused runtime contract tests

- [ ] **Step 1: Write the failing unit expectations for `/` to stop behaving like the chat shell**

Add/update assertions so the old browser-runtime contract is replaced by a ttyd-first surface contract.

- [ ] **Step 2: Run the focused unit test to verify it fails**

Run the focused runtime contract test.
Expected: FAIL because the current `/` surface still serves the old browser app.

- [ ] **Step 3: Write the failing NixOS smoke expectation for ttyd-first browser entry**

Update `tests/nixos/nixpi-firstboot.nix` and `tests/nixos/nixpi-chat.nix` so they stop treating the chat service as the main browser contract and instead assert that browser access to `/` lands on the terminal-first surface.

- [ ] **Step 4: Run the focused integration guard to verify it fails at the right boundary**

Run: `npm test -- tests/integration/standards-guard.test.ts`
Expected: PASS or unaffected. If a new standards guard is needed for terminal-first routing, add it and rerun until the new guard fails for the current implementation.

- [ ] **Step 5: Commit the red-state tests**

```bash
git add tests/nixos/nixpi-firstboot.nix tests/nixos/nixpi-chat.nix
git commit -m "Define the ttyd-first browser surface contract"
```

---

### Task 2: Add the terminal bootstrap wrapper and ttyd wiring

**Files:**
- Create: `core/scripts/nixpi-terminal-bootstrap.sh`
- Create: `core/os/pkgs/nixpi-terminal-bootstrap/default.nix`
- Modify: `core/os/modules/ttyd.nix`
- Modify: `flake.nix`
- Test: `tests/integration/standards-guard.test.ts`

- [ ] **Step 1: Write a failing standards/integration guard for the bootstrap wrapper**

Add assertions to `tests/integration/standards-guard.test.ts` (or a new focused integration test) that require:
- `core/scripts/nixpi-terminal-bootstrap.sh` to exist
- ttyd to launch the wrapper instead of raw bash
- the wrapper to exec Pi when appropriate and fall back safely to bash semantics when not

- [ ] **Step 2: Run the guard to verify it fails**

Run: `npm test -- tests/integration/standards-guard.test.ts`
Expected: FAIL because the wrapper does not exist yet and ttyd still launches bash directly.

- [ ] **Step 3: Implement the minimal wrapper and Nix package wiring**

Create `core/scripts/nixpi-terminal-bootstrap.sh` as a small shell wrapper that:
- sets Pi-related environment defaults
- starts in the primary user's home/state context
- enters Pi in the most explicit/testable way possible
- avoids hidden browser-only logic

Create `core/os/pkgs/nixpi-terminal-bootstrap/default.nix` to install that script, then update `core/os/modules/ttyd.nix` to run ttyd against the wrapper command.

- [ ] **Step 4: Run the guard again to verify it passes**

Run: `npm test -- tests/integration/standards-guard.test.ts`
Expected: PASS with the new wrapper and ttyd ExecStart contract in place.

- [ ] **Step 5: Commit the ttyd bootstrap wiring**

```bash
git add core/scripts/nixpi-terminal-bootstrap.sh core/os/pkgs/nixpi-terminal-bootstrap/default.nix core/os/modules/ttyd.nix flake.nix tests/integration/standards-guard.test.ts
git commit -m "Make ttyd enter NixPI through an explicit Pi bootstrap wrapper"
```

---

### Task 3: Route the canonical web surface to ttyd and remove chat from the critical path

**Files:**
- Modify: `core/os/modules/service-surface.nix`
- Modify: `core/os/modules/app.nix`
- Modify: `core/os/pkgs/app/default.nix`
- Delete: legacy browser-runtime source
- Test: focused runtime contract tests and `tests/nixos/nixpi-chat.nix`

- [ ] **Step 1: Decide the smallest viable survival path for chat artifacts**

Prefer deletion if possible. If some package/runtime code still depends on the app package for Pi assets, keep only what is required for Pi packaging and remove browser chat/server responsibilities from the primary product path.

- [ ] **Step 2: Implement the minimal NixOS routing change**

Update `core/os/modules/service-surface.nix` so `/` points to ttyd instead of the chat service. Keep WebSocket upgrade handling correct for terminal traffic.

- [ ] **Step 3: Remove or narrow the chat service wiring**

Update `core/os/modules/app.nix` and `core/os/pkgs/app/default.nix` so packaging focuses on Pi runtime assets rather than a browser chat frontend. Delete dead chat-server code if nothing depends on it.

- [ ] **Step 4: Run the focused unit test to verify the new surface passes**

Run the replacement focused runtime contract checks.
Expected: PASS.

- [ ] **Step 5: Commit the surface simplification**

```bash
git add core/os/modules/service-surface.nix core/os/modules/app.nix core/os/pkgs/app/default.nix tests/nixos/nixpi-chat.nix
git commit -m "Route the browser surface directly into ttyd and retire chat-first wiring"
```

---

### Task 4: Move setup-vs-normal gating fully into Pi behavior

**Files:**
- Modify: `core/pi/extensions/persona/actions.ts`
- Modify: `core/pi/extensions/persona/index.ts`
- Modify: `core/pi/skills/first-boot/SKILL.md`
- Modify: `tests/extensions/persona.test.ts`

- [ ] **Step 1: Write the failing extension tests for new `system-ready` semantics**

Update `tests/extensions/persona.test.ts` so setup gating reflects the new meaning:
- missing `system-ready` => Pi stays in setup mode
- present `system-ready` => normal mode
- old persona/web-chat copy is no longer assumed

- [ ] **Step 2: Run the persona tests to verify they fail**

Run: `npm test -- tests/extensions/persona.test.ts`
Expected: FAIL because the current setup copy still assumes the older browser-app narrative.

- [ ] **Step 3: Implement the minimal extension/skill changes**

Update the persona/setup extension and `core/pi/skills/first-boot/SKILL.md` so Pi becomes the setup copilot in terminal-first mode, using `system-ready` as the final onboarding gate and removing outdated browser-chat assumptions.

- [ ] **Step 4: Run the persona tests again to verify they pass**

Run: `npm test -- tests/extensions/persona.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit the Pi-native setup gating**

```bash
git add core/pi/extensions/persona/actions.ts core/pi/extensions/persona/index.ts core/pi/skills/first-boot/SKILL.md tests/extensions/persona.test.ts
git commit -m "Move onboarding gating into Pi and redefine system-ready as full completion"
```

---

### Task 5: Update docs and NixOS end-to-end expectations

**Files:**
- Modify: `README.md`
- Modify: `docs/operations/quick-deploy.md`
- Modify: `docs/operations/first-boot-setup.md`
- Modify: `tests/nixos/nixpi-firstboot.nix`
- Modify: `tests/nixos/nixpi-vps-bootstrap.nix`
- Modify: `tests/nixos/nixpi-e2e.nix`

- [ ] **Step 1: Replace chat-first operator language with Pi-in-terminal language**

Update docs so the canonical story is:
- browser => ttyd
- Pi is the interface
- same flow works over ttyd, SSH, or local shell
- `system-ready` means onboarding fully complete

- [ ] **Step 2: Update the NixOS tests to match the new story**

Change assertions that currently require the removed browser app, old browser responses, or old milestone semantics. Replace them with terminal-first routing and setup-mode expectations.

- [ ] **Step 3: Run the documentation-adjacent and targeted test suites**

Run:
- `npm test -- tests/extensions/persona.test.ts tests/integration/standards-guard.test.ts`
- replacement focused runtime contract tests if the browser runtime is removed

Expected: PASS.

- [ ] **Step 4: Run formatting/lint/type/build verification**

Run:
- `npm run check`
- `npm run build`

Expected: both exit successfully.

- [ ] **Step 5: Commit the docs and verification updates**

```bash
git add README.md docs/operations/quick-deploy.md docs/operations/first-boot-setup.md tests/nixos/nixpi-firstboot.nix tests/nixos/nixpi-vps-bootstrap.nix tests/nixos/nixpi-e2e.nix
git commit -m "Document NixPI as a Pi-first terminal surface across browser and shell transports"
```

---

### Task 6: Final verification

**Files:**
- Verify working tree and test evidence only

- [ ] **Step 1: Run the complete targeted verification set**

Run:
```bash
npm test -- tests/extensions/persona.test.ts tests/integration/standards-guard.test.ts
npm run check
npm run build
```

Expected: all commands succeed, or if chat-server tests were replaced, the replacement targeted suite succeeds instead.

- [ ] **Step 2: Run at least one relevant NixOS/system test if feasible**

Run one of:
```bash
nix build .#checks.x86_64-linux.nixpi-firstboot --no-link -L
nix build .#checks.x86_64-linux.nixpi-chat --no-link -L
```

Expected: the updated system contract passes.

- [ ] **Step 3: Inspect the final diff for dead code and stale chat assumptions**

Run:
```bash
git diff --stat
git diff -- . ':(exclude)package-lock.json'
```

Expected: no stale references to the old chat-first product remain in the main flow.

- [ ] **Step 4: Make the final commit**

```bash
git add -A
git commit -m "Center NixPI on a Pi-first terminal surface"
```
