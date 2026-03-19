# Stability Sweep — Design Spec
_Date: 2026-03-19_

## Overview

A methodical, subsystem-by-subsystem cleanup of the Bloom OS codebase. The goal is a smaller, cleaner, fully-tested platform by removing script/Nix workarounds, eliminating TypeScript defensive code that compensates for bad interfaces, and raising test coverage to meaningful thresholds. All 7 extensions stay. No new features.

---

## Scope

### In scope

- Remove Bash/Nix workarounds: fragile path-probe fallback chains, sourcing guards, conditionals that exist because structure is wrong
- Remove TypeScript defensive code: silent `try/catch` that returns `undefined`, defensive null-checks on values the type system already guarantees, over-wide guards at internal boundaries
- Raise test coverage in weak areas (bloom-os, bloom-garden, bloom-episodes, bloom-objects)
- Upgrade Biome to v2 and enable `noFloatingPromises` (catches unhandled async failures that generate defensive downstream fixes)
- Add one real operator e2e journey (setup → daemon start → first tool call)
- Promote two NixOS smoke tests to required CI gates
- Replace `Value.Check` + manual guard patterns with `Value.Parse` at external data boundaries

### Out of scope

- No extension removals (all 7 stay: bloom-persona, bloom-localai, bloom-os, bloom-episodes, bloom-objects, bloom-garden, bloom-setup)
- No new features
- No architectural rewrites of the daemon (already at 83% coverage and internally coherent)
- No changes to Pi/Matrix protocol behavior

### Definition of "custom fix" / workaround

A piece of code that exists to compensate for a structural problem rather than to implement actual behavior:

- Path-probe fallback chains where a single correct path would do
- Boolean guards preventing a module executing when sourced (e.g. the old `BLOOM_FIRSTBOOT_SOURCING=1` pattern — already removed, must not recur)
- `try/catch` blocks that swallow errors and return `undefined` instead of surfacing failures to callers
- Defensive null-checks on values TypeScript already guarantees are non-null
- Nix hacks compensating for mis-structured package definitions

---

## Approach: Subsystem-by-Subsystem Sweep

Work from fewest dependencies to most. Each subsystem is complete when: workarounds removed, interfaces clean, tests pass, coverage at target. Only move to the next subsystem after the stability gate passes.

### Sweep Order

| # | Subsystem | Rationale |
|---|---|---|
| 1 | Tooling (Biome, Vitest config) | Foundation — linter and coverage config affect everything downstream |
| 2 | `core/scripts` | Pure Bash, no TypeScript dependencies, isolated |
| 3 | `core/os` (Nix modules + packages) | Nix only, no runtime TypeScript dependencies |
| 4 | `core/lib` | Shared TypeScript utilities — must be clean before extensions touch it |
| 5 | `core/daemon` | Already healthy; trim only, preserve test coverage |
| 6 | Extensions (in order below) | Each depends on lib; order by isolation |
| 7 | Tests (e2e + CI gate) | Cross-cutting, done last once all subsystems are clean |

Extension sweep order within step 6:
`bloom-setup` → `bloom-localai` → `bloom-os` → `bloom-garden` → `bloom-episodes` → `bloom-objects` → `bloom-persona`

Rationale: bloom-setup and bloom-localai are the simplest/most isolated; bloom-persona last as it touches guardrails and session hooks.

---

## Per-Subsystem Contract

### 1. Tooling

**Biome:**
- Upgrade from v1.9.4 → v2 (latest stable)
- Enable `nursery.noFloatingPromises: "error"` — catches unhandled promises that produce silent failures and defensive downstream code
- Keep existing rules; review any rules promoted from nursery to stable in v2 and enable recommended ones

**Vitest (`vitest.config.ts`):**
- Add `clearMocks: true` and `restoreMocks: true` globally — prevents mock state leaking between tests
- Set coverage thresholds per glob (see Testing Strategy section)
- Do NOT enable `autoUpdate` — thresholds are raised deliberately, not automatically

**Done when:** `npm run check` passes with Biome v2; `npm run test:ci` passes with new thresholds.

---

### 2. `core/scripts`

**Files:** `bloom-lib.sh`, `bloom-wizard.sh`, `bloom-firstboot.sh`, `bloom-update.sh`, `bloom-greeting.sh`, `run-qemu.sh`

**Audit targets:**
- Any remaining dead fallback paths (probe → fallback where the probe is structurally guaranteed to fail)
- Any implicit execution guards (`if [[ -z "$SOURCING" ]]` patterns)
- Duplicated logic not yet consolidated into `bloom-lib.sh`

**Done when:** All scripts pass `bash -n`; no dead sourcing guards; `bloom-lib.sh` is the single home for shared functions.

---

### 3. `core/os`

**Files:** All Nix modules, host configurations, and packages under `core/os/`

**Audit targets:**
- The Cachix TODO placeholder in `bloom-update.nix` — either implement or remove the commented block cleanly
- Any remaining `qcow2`/`raw` duplication not yet collapsed (check flake.nix post-structural-cleanup)
- Module options that exist but are never set by any host config (dead options)

**Done when:** `nix eval .#nixosConfigurations.bloom-x86_64.config.system.stateVersion` succeeds; no placeholder TODOs; `just check-config` passes.

---

### 4. `core/lib`

**Files:** All `.ts` files under `core/lib/`

**Audit targets:**
- Defensive null-checks on values TypeScript's strict mode already guarantees
- `try/catch` blocks that catch `unknown` and return `undefined` — convert to explicit error types or let errors propagate
- Any helpers that exist only because a caller upstream had bad types (fix the caller, remove the helper)
- Replace `Value.Check(T, x)` + manual guard with `Value.Parse(T, x)` at external data boundaries (filesystem reads, Matrix event payloads)

**Done when:** Coverage ≥ 85% (statements, functions, lines); `npm run check` clean; no `// @ts-ignore` or `as unknown as` casts.

---

### 5. `core/daemon`

**Files:** All `.ts` files under `core/daemon/`

**Audit targets:**
- TypeScript defensive code only — do not restructure working logic
- Silent error swallowing in event handlers (Matrix SDK callbacks that `catch` and log but never propagate)
- Over-wide `catch (e: unknown)` that discard error context

**Done when:** Coverage ≥ 85% (already at 83%, minimal work); no new `// eslint-disable` or Biome suppression comments added during cleanup.

---

### 6. Extensions

For each extension, the contract is identical:

**Audit targets:**
- `Value.Check` + manual guard → replace with `Value.Parse` at tool input boundaries
- Silent `catch` returning `undefined` or empty objects — surface errors to callers
- Tool implementations that defensively re-validate already-validated internal state
- Any extension that re-implements a utility already in `core/lib`

**Coverage targets per extension:**

| Extension | Current | Target |
|---|---|---|
| bloom-setup | ~moderate | ≥ 60% |
| bloom-localai | unknown | ≥ 60% |
| bloom-os | ~10% | ≥ 60% |
| bloom-garden | ~moderate | ≥ 60% |
| bloom-episodes | ~good | ≥ 60% |
| bloom-objects | ~good | ≥ 60% |
| bloom-persona | ~good | ≥ 60% |

**Done when:** All extensions at ≥ 60% coverage; `Value.Parse` used at all tool input boundaries; no silent error swallowing.

---

### 7. Tests

**E2E operator journey:**

Add one test to `tests/e2e/` that exercises a real operator path:
1. Extension registration (already exists — keep it)
2. New: setup state reads as expected after initialization
3. New: a tool call through a registered extension returns a valid result

This does not require a running Matrix server — it should use the existing mock extension API helpers in `tests/helpers/`.

**NixOS CI gate:**

In `.github/workflows/build-os.yml`, promote two checks to required (non-optional) steps:
- `nix build .#checks.x86_64-linux.bloom-boot` — first-boot smoke test
- `nix build .#checks.x86_64-linux.bloom-daemon` — daemon startup smoke test

These are currently available but not enforced. They become required gates before merge.

**Done when:** `tests/e2e/` contains at least one real workflow test; CI workflow enforces `bloom-boot` and `bloom-daemon`; all existing tests still pass.

---

## Testing Strategy

### Coverage thresholds (enforced in `vitest.config.ts`)

```typescript
coverage: {
  thresholds: {
    'core/lib/**/*.ts': {
      statements: 85,
      functions: 85,
      lines: 85,
      branches: 70
    },
    'core/daemon/**/*.ts': {
      statements: 85,
      functions: 80,
      lines: 85,
      branches: 75
    },
    'core/pi-extensions/**/*.ts': {
      statements: 60,
      functions: 60,
      lines: 60,
      branches: 50
    }
  }
}
```

### Global Vitest settings to add

```typescript
clearMocks: true,
restoreMocks: true
```

### TypeBox usage standard

At all external data boundaries (tool inputs, filesystem reads, Matrix event payloads):

**Before (current pattern):**
```typescript
if (!Value.Check(T, data)) {
  return { error: 'invalid input' }
}
const typed = data as Static<typeof T>
```

**After (target pattern):**
```typescript
const typed = Value.Parse(T, data) // throws Value.ParseError on invalid input
```

Internal functions that receive already-validated data do not need re-validation.

---

## Stability Gate

**Per-subsystem gate** (must pass before moving to next subsystem):
```bash
npm run build && npm run check && npm run test:ci
```

**Final gate** (must pass before the sweep is considered complete):
```bash
nix eval .#checks.x86_64-linux --apply builtins.attrNames  # all checks present
npm run test:ci                                              # full suite + coverage thresholds met
```

---

## File Change Summary

| Area | Change |
|---|---|
| `package.json` | Bump Biome to v2 |
| `biome.json` | Update schema version; enable `noFloatingPromises` |
| `vitest.config.ts` | Add `clearMocks`, `restoreMocks`; raise coverage thresholds per glob |
| `core/scripts/*.sh` | Remove dead fallback paths and sourcing guards |
| `core/os/modules/bloom-update.nix` | Remove Cachix placeholder TODO or implement |
| `flake.nix` | Verify deduplication complete; remove any remaining dead outputs |
| `core/lib/*.ts` | Remove defensive null-checks; convert `Value.Check` guards to `Value.Parse` |
| `core/daemon/*.ts` | Remove silent error swallowing; no restructuring |
| `core/pi-extensions/**/*.ts` | Convert tool input validation to `Value.Parse`; raise coverage |
| `tests/e2e/` | Add real operator journey test |
| `.github/workflows/build-os.yml` | Promote `bloom-boot` and `bloom-daemon` to required gates |
