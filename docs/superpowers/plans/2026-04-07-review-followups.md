# Review Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the verified post-review defects with regression tests and keep the repo lint/test/build clean.

**Architecture:** Make localized corrections in the interaction layer, object-store read path, blueprint source resolution, broker command boundary, and chat HTTP body handling. Prefer narrow behavior-preserving edits with explicit tests over broader refactors.

**Tech Stack:** TypeScript, Vitest, Vite, Biome, Node HTTP/fs/net

---

### Task 1: Guard ambiguous confirmation replies

**Files:**
- Modify: `core/lib/interactions.ts`
- Modify: `tests/lib/shared.test.ts`

- [ ] **Step 1: Write the failing test**
Add a test proving `requireConfirmation()` refuses an untokened reply when multiple prompts are pending and instead returns a tokenized prompt.

- [ ] **Step 2: Run test to verify it fails**
Run: `npm test -- tests/lib/shared.test.ts`
Expected: the new confirmation-disambiguation test fails.

- [ ] **Step 3: Write minimal implementation**
Update `requireConfirmation()` to treat ambiguous resolved confirmations as unresolved and re-prompt with a fresh explicit confirmation token.

- [ ] **Step 4: Run test to verify it passes**
Run: `npm test -- tests/lib/shared.test.ts`
Expected: targeted tests pass.

### Task 2: Make memory reads side-effect free

**Files:**
- Modify: `core/pi/extensions/objects/actions.ts`
- Modify: `tests/extensions/objects.test.ts`

- [ ] **Step 1: Write the failing test**
Add a test proving `memory_read` does not rewrite the underlying file.

- [ ] **Step 2: Run test to verify it fails**
Run: `npm test -- tests/extensions/objects.test.ts`
Expected: the new read-only test fails.

- [ ] **Step 3: Write minimal implementation**
Remove the write-back path from `readObject()` and keep the existing read/truncate behavior.

- [ ] **Step 4: Run test to verify it passes**
Run: `npm test -- tests/extensions/objects.test.ts`
Expected: targeted tests pass.

### Task 3: Fix blueprint update source resolution

**Files:**
- Modify: `core/pi/extensions/nixpi/actions-blueprints.ts`
- Modify: `tests/extensions/nixpi.test.ts`

- [ ] **Step 1: Write the failing test**
Add a regression test where persona content exists only in `core/pi/persona`, `updatesAvailable` contains `persona/SOUL.md`, and `handleUpdateBlueprints()` must update the workspace persona file.

- [ ] **Step 2: Run test to verify it fails**
Run: `npm test -- tests/extensions/nixpi.test.ts`
Expected: the new blueprint update test fails.

- [ ] **Step 3: Write minimal implementation**
Extract a shared helper mapping blueprint keys to source files, and reuse it from both seeding and update paths.

- [ ] **Step 4: Run test to verify it passes**
Run: `npm test -- tests/extensions/nixpi.test.ts`
Expected: targeted tests pass.

### Task 4: Enforce canonical flake use at the broker boundary

**Files:**
- Modify: `core/os/broker.ts`
- Modify: `tests/os/broker.test.ts`

- [ ] **Step 1: Write the failing test**
Add a test proving `handleRequest(... { operation: "nixos-update", action: "apply", flake: "evil#host" })` still executes `config.defaultFlake` after elevation.

- [ ] **Step 2: Run test to verify it fails**
Run: `npm test -- tests/os/broker.test.ts`
Expected: the new canonical-flake test fails.

- [ ] **Step 3: Write minimal implementation**
Change the broker apply branch to ignore `request.flake` and execute `config.defaultFlake`. While editing, simplify the request dispatcher enough to satisfy the complexity warning.

- [ ] **Step 4: Run test to verify it passes**
Run: `npm test -- tests/os/broker.test.ts`
Expected: targeted tests pass.

### Task 5: Reject oversized chat request bodies

**Files:**
- Modify: legacy browser-runtime entrypoint (since removed)
- Modify: legacy browser-runtime test coverage (since removed)

- [ ] **Step 1: Write the failing test**
Add a server test that posts an oversized JSON body and expects HTTP 413.

- [ ] **Step 2: Run test to verify it fails**
Run the legacy browser-runtime contract test (historical; runtime later removed)
Expected: the new size-limit test fails.

- [ ] **Step 3: Write minimal implementation**
Introduce a chat body-size constant, cap buffered input in `readRequestBody`, and return 413 from the chat handler when exceeded.

- [ ] **Step 4: Run test to verify it passes**
Run the legacy browser-runtime contract test (historical; runtime later removed)
Expected: targeted tests pass.

### Task 6: Final verification and hygiene

**Files:**
- Modify: touched files only as needed for formatting/import order

- [ ] **Step 1: Run focused touched-suite verification**
Run: `npm test -- tests/lib/shared.test.ts tests/extensions/objects.test.ts tests/extensions/nixpi.test.ts tests/os/broker.test.ts`
Expected: all targeted suites pass.

- [ ] **Step 2: Run full verification**
Run: `npm test && npx @biomejs/biome ci core tests vite.config.ts vitest.config.ts package.json tsconfig.json biome.json && npm run build`
Expected: all commands pass.

- [ ] **Step 3: Prepare final summary**
List changed files, behavior changes, verification evidence, and any remaining risks.
