# Architecture Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate extensions to directory structure, reorganize lib/ by capability, and create a service scaffold template — as defined in `ARCHITECTURE.md`.

**Architecture:** Extensions become directories (`index.ts` wiring + `actions.ts` handlers + `types.ts`). lib/ splits from `shared.ts` monolith into capability files. Services get a scaffold template. All tests must keep passing throughout.

**Tech Stack:** TypeScript (strict, ES2022, NodeNext), Vitest, Biome

---

## Phase 1: lib/ Reorganization

### Task 1: Create lib/frontmatter.ts

Extract frontmatter functions from `shared.ts` into a dedicated capability file.

**Files:**
- Create: `lib/frontmatter.ts`
- Modify: `lib/shared.ts`

**Step 1: Create `lib/frontmatter.ts`**

Move these items from `shared.ts`:
- `ParsedFrontmatter<T>` interface
- `parseFrontmatter()` function
- `stringifyFrontmatter()` function
- `FRONTMATTER_ARRAY_KEYS` constant
- `yaml` constant (the js-yaml wrapper)

The file needs these imports:
```ts
import jsYaml from "js-yaml";
import matter from "@11ty/gray-matter";
```

**Step 2: Remove moved items from `shared.ts`**

Remove the functions/types/constants listed above. Remove the `matter` and `jsYaml` imports (they're no longer needed in shared.ts). Keep the `yaml` re-export temporarily for backwards compatibility — we'll remove it after updating all consumers.

Actually: do NOT keep backwards compat re-exports. We'll update all imports in Task 5.

**Step 3: Run tests**

Run: `npm test`
Expected: Failures in files that import from `lib/shared.ts` for frontmatter functions. That's fine — Task 5 fixes imports.

**Step 4: Commit**

```bash
git add lib/frontmatter.ts lib/shared.ts
git commit -m "refactor(lib): extract frontmatter capability from shared.ts"
```

---

### Task 2: Create lib/filesystem.ts

Extract filesystem functions from `shared.ts`.

**Files:**
- Create: `lib/filesystem.ts`
- Modify: `lib/shared.ts`

**Step 1: Create `lib/filesystem.ts`**

Move from `shared.ts`:
- `safePath()` function
- `getBloomDir()` function

Needs imports:
```ts
import os from "node:os";
import path from "node:path";
```

**Step 2: Remove moved items from `shared.ts`**

Remove `safePath`, `getBloomDir`, and their now-unused `node:os` and `node:path` imports from `shared.ts`.

**Step 3: Commit**

```bash
git add lib/filesystem.ts lib/shared.ts
git commit -m "refactor(lib): extract filesystem capability from shared.ts"
```

---

### Task 3: Merge service-utils.ts into services.ts

Rename `manifest.ts` to `services.ts` and merge `service-utils.ts` into it.

**Files:**
- Rename: `lib/manifest.ts` → `lib/services.ts`
- Delete: `lib/service-utils.ts`

**Step 1: Rename manifest.ts to services.ts**

```bash
git mv lib/manifest.ts lib/services.ts
```

**Step 2: Merge service-utils.ts content into services.ts**

Append the three functions from `service-utils.ts` to the end of `services.ts`:
- `validateServiceName()`
- `validatePinnedImage()`
- `commandMissingError()`

These have no external imports beyond what `services.ts` already has.

**Step 3: Delete service-utils.ts**

```bash
git rm lib/service-utils.ts
```

**Step 4: Commit**

```bash
git add lib/services.ts
git commit -m "refactor(lib): merge service-utils into services.ts (capability naming)"
```

---

### Task 4: Rename audit-utils.ts to audit.ts

**Files:**
- Rename: `lib/audit-utils.ts` → `lib/audit.ts`

**Step 1: Rename**

```bash
git mv lib/audit-utils.ts lib/audit.ts
```

**Step 2: Commit**

```bash
git add lib/audit.ts
git commit -m "refactor(lib): rename audit-utils to audit (capability naming)"
```

---

### Task 5: Update all imports across codebase

Fix every import that references old lib/ paths. This is the big mechanical step.

**Files:**
- Modify: All 10 extension files
- Modify: All test files that import from lib/

**Import mapping:**

| Old import | New import |
|-----------|-----------|
| `../lib/shared.ts` → `parseFrontmatter`, `stringifyFrontmatter`, `yaml`, `ParsedFrontmatter` | `../lib/frontmatter.js` |
| `../lib/shared.ts` → `safePath`, `getBloomDir` | `../lib/filesystem.js` |
| `../lib/shared.ts` → `createLogger`, `truncate`, `errorResult`, `requireConfirmation`, `nowIso`, `guardBloom` | `../lib/shared.js` (stays) |
| `../lib/manifest.ts` (or `../lib/manifest.js`) | `../lib/services.js` |
| `../lib/service-utils.ts` (or `../lib/service-utils.js`) | `../lib/services.js` |
| `../lib/audit-utils.ts` (or `../lib/audit-utils.js`) | `../lib/audit.js` |

**Step 1: Update extension imports**

For each extension file, split imports from `../lib/shared.js` into:
- Frontmatter functions → `../lib/frontmatter.js`
- Filesystem functions → `../lib/filesystem.js`
- Remaining utilities → `../lib/shared.js`

Update `manifest.js` → `services.js`, `service-utils.js` → `services.js`, `audit-utils.js` → `audit.js`.

Affected extensions (check each file's actual imports):
- `bloom-audit.ts` — imports from `shared` (createLogger, getBloomDir, truncate) + `audit-utils`
- `bloom-channels.ts` — imports from `shared` (createLogger)
- `bloom-display.ts` — imports from `shared` (errorResult, truncate) + `exec`
- `bloom-garden.ts` — imports from `shared` (errorResult, getBloomDir, nowIso, safePath, stringifyFrontmatter, truncate)
- `bloom-objects.ts` — imports from `shared` (errorResult, getBloomDir, nowIso, parseFrontmatter, safePath, stringifyFrontmatter, truncate)
- `bloom-os.ts` — imports from `shared` (errorResult, guardBloom, requireConfirmation, truncate) + `exec`
- `bloom-persona.ts` — imports from `shared` (createLogger, getBloomDir, yaml)
- `bloom-repo.ts` — imports from `shared` (errorResult, requireConfirmation) + `exec` + `repo`
- `bloom-services.ts` — imports from `shared` + `manifest` + `service-utils` + `exec`
- `bloom-topics.ts` — no lib imports

**Step 2: Update test imports**

- `tests/lib/shared.test.ts` — split into testing frontmatter.ts, filesystem.ts, and shared.ts (or just update imports, keep test file intact)
- `tests/lib/audit-utils.test.ts` — update import path to `audit.js`
- `tests/lib/manifest.test.ts` — update import path to `services.js`
- `tests/lib/service-utils.test.ts` — update import path to `services.js`
- `tests/integration/frontmatter-roundtrip.test.ts` — update imports
- `tests/integration/garden-seeding.test.ts` — update imports if needed
- `tests/integration/guardrails.test.ts` — update imports
- `tests/integration/object-lifecycle.test.ts` — update imports
- `tests/integration/persona-guardrails.test.ts` — update imports
- `tests/extensions/*.test.ts` — update imports as needed

**Step 3: Run tests**

Run: `npm test`
Expected: ALL PASS (255 tests)

**Step 4: Run Biome check**

Run: `npm run check`
Expected: No new errors (pre-existing 2 errors + ~29 warnings are OK)

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor(lib): update all imports for capability-based lib organization"
```

---

## Phase 2: Extension Directory Migration

All 10 extensions follow the same pattern. Each task creates a directory, splits the file, and verifies tests pass.

### Migration Pattern (applies to every extension)

For extension `bloom-{name}.ts`:

**Step 1: Create directory and move file**
```bash
mkdir -p extensions/bloom-{name}
git mv extensions/bloom-{name}.ts extensions/bloom-{name}/index.ts
```

**Step 2: Create `actions.ts`**

Extract all handler/business logic from `index.ts` into `actions.ts`. What stays in `index.ts`:
- The `export default function(pi: ExtensionAPI)` wrapper
- All `pi.registerTool()`, `pi.registerHook()`, `pi.registerCommand()` calls
- The calls INTO action functions (which now live in actions.ts)

What moves to `actions.ts`:
- Handler function bodies (the actual logic inside tool/hook callbacks)
- Helper functions that aren't Pi SDK wiring
- Any exported utility functions (e.g., `normalizeCommand` from bloom-persona)

**Step 3: Create `types.ts`**

Move extension-specific type definitions. If no types exist, create an empty file with a comment:
```ts
// Extension-specific types for bloom-{name}
```

**Step 4: Update imports in `index.ts`**

Import action functions from `./actions.js` and types from `./types.js`.

**Step 5: Fix relative lib imports**

Since files moved from `extensions/` to `extensions/bloom-{name}/`, lib imports change:
- `../lib/shared.js` → `../../lib/shared.js`
- `../lib/exec.js` → `../../lib/exec.js`
- etc.

**Step 6: Run tests, verify pass**

Run: `npm test`

**Step 7: Commit**

```bash
git add extensions/bloom-{name}/
git commit -m "refactor(extensions): migrate bloom-{name} to directory structure"
```

---

### Task 6: Migrate bloom-topics (simplest — no lib imports, 162 lines)

Follow migration pattern. This is the simplest extension — good first test.

- `index.ts`: keeps command/hook registration
- `actions.ts`: topic CRUD logic (newTopic, closeTopic, listTopics, switchTopic)
- `types.ts`: empty (uses Pi SDK types only)
- No lib import path changes needed (no lib imports)

---

### Task 7: Migrate bloom-audit (178 lines)

- `index.ts`: tool + hook registration
- `actions.ts`: audit rotation, entry filtering, JSONL read/write
- `types.ts`: AuditEntry interface if defined inline
- Update lib imports: `../../lib/audit.js`, `../../lib/shared.js`, `../../lib/filesystem.js`

---

### Task 8: Migrate bloom-persona (219 lines)

- `index.ts`: hook registrations (session_start, before_agent_start, tool_call, session_before_compact)
- `actions.ts`: persona loading, guardrail checking, context persistence, `normalizeCommand` (exported)
- `types.ts`: guardrail types if any
- Update lib imports: add `../../` prefix
- Note: `normalizeCommand` is exported and used by tests — keep it exported from actions.ts

---

### Task 9: Migrate bloom-display (320 lines)

- `index.ts`: display tool registration
- `actions.ts`: screenshot capture, xdotool input, xpra WM, ui-tree, all 10 action handlers
- `types.ts`: action parameter types if any
- Update lib imports: `../../lib/exec.js`, `../../lib/shared.js`

---

### Task 10: Migrate bloom-objects (315 lines)

- `index.ts`: 5 tool registrations
- `actions.ts`: CRUD, search, linking logic, `parseRef` (exported)
- `types.ts`: object frontmatter types
- Update lib imports: `../../lib/frontmatter.js`, `../../lib/filesystem.js`, `../../lib/shared.js`

---

### Task 11: Migrate bloom-os (338 lines)

- `index.ts`: 6 tool registrations + before_agent_start hook
- `actions.ts`: bootc/container/systemd/health handlers, parallel health check composition
- `types.ts`: health check result types
- Update lib imports: `../../lib/exec.js`, `../../lib/shared.js`

---

### Task 12: Migrate bloom-repo (363 lines)

- `index.ts`: 2 tool registrations
- `actions.ts`: repo configure/status/sync, PR workflow, `parseGithubSlugFromUrl` + `slugifyBranchPart` (both exported)
- `types.ts`: empty or repo config types
- Update lib imports: `../../lib/exec.js`, `../../lib/shared.js`, `../../lib/repo.js`

---

### Task 13: Migrate bloom-garden (396 lines)

- `index.ts`: 4 tool + 2 command + 2 hook registrations
- `actions.ts`: garden init, blueprint seeding/versioning, skill creation, persona evolution
- `types.ts`: blueprint metadata types
- Update lib imports: `../../lib/frontmatter.js`, `../../lib/filesystem.js`, `../../lib/shared.js`

---

### Task 14: Migrate bloom-channels (482 lines)

- `index.ts`: 2 command + 3 hook registrations
- `actions.ts`: socket server, channel registration, heartbeat, rate limiting, message correlation, `getPairingData`/`setPairingData`/`clearPairingData`/`extractResponseText` (all exported, used by bloom-services)
- `types.ts`: channel message types, registration types
- Update lib imports: `../../lib/shared.js`
- **Important**: bloom-services imports from bloom-channels — update that import path too

---

### Task 15: Migrate bloom-services (831 lines — largest)

- `index.ts`: 8 tool + 1 hook registrations
- `actions.ts`: service scaffold/install/test/pair, manifest show/sync/set/apply, drift detection
- `types.ts`: manifest types, catalog types (if not already in lib/services.ts)
- Update lib imports: `../../lib/exec.js`, `../../lib/services.js`, `../../lib/shared.js`, `../../lib/frontmatter.js`, `../../lib/filesystem.js`
- Update bloom-channels import: `../bloom-channels/actions.js`

---

### Task 16: Update test imports for extension directories

All extension test files in `tests/extensions/` import from extensions. Update paths:

| Old import | New import |
|-----------|-----------|
| `../../extensions/bloom-{name}.js` | `../../extensions/bloom-{name}/index.js` or `../../extensions/bloom-{name}/actions.js` |

Check each test file:
- `tests/extensions/bloom-channels.test.ts`
- `tests/extensions/bloom-display.test.ts`
- `tests/extensions/bloom-objects.test.ts`
- `tests/extensions/bloom-os.test.ts`
- `tests/extensions/bloom-persona.test.ts`
- `tests/extensions/bloom-repo.test.ts`

Also check integration tests that may import extension code:
- `tests/integration/guardrails.test.ts` (may import normalizeCommand)
- `tests/integration/persona-guardrails.test.ts`
- `tests/e2e/extension-registration.test.ts`

**Step 1: Update all test imports**

**Step 2: Run full test suite**

Run: `npm test`
Expected: ALL PASS (255 tests)

**Step 3: Run Biome**

Run: `npm run check`

**Step 4: Commit**

```bash
git add tests/
git commit -m "refactor(tests): update imports for extension directory migration"
```

---

### Task 17: Update tsconfig.json and vitest.config.ts

Verify the `include` patterns still work with the new directory structure.

**tsconfig.json:** `"include": ["extensions/**/*.ts", "lib/**/*.ts", "tests/**/*.ts"]` — this already uses `**` globs, so nested directories are included. No change needed.

**vitest.config.ts:** `include: ["tests/**/*.test.ts"]` — still correct. Coverage `include: ["lib/**/*.ts", "extensions/**/*.ts"]` — still correct with directories.

**Step 1: Verify build works**

Run: `npm run build`
Expected: Clean compilation

**Step 2: Verify tests with coverage**

Run: `npm run test:coverage`
Expected: All pass, coverage thresholds met

**Step 3: Commit if any config changes were needed**

---

## Phase 3: Service Scaffold Template

### Task 18: Create services/_template/

Build a scaffold template based on the whatsapp/signal service pattern.

**Files:**
- Create: `services/_template/Containerfile`
- Create: `services/_template/package.json`
- Create: `services/_template/src/index.ts`
- Create: `services/_template/src/transport.ts`
- Create: `services/_template/src/utils.ts`
- Create: `services/_template/tests/transport.test.ts`
- Create: `services/_template/tests/utils.test.ts`
- Create: `services/_template/quadlet/bloom-TEMPLATE.container`

**Step 1: Study existing services**

Read `services/whatsapp/` and `services/signal/` to extract common patterns:
- Containerfile structure
- Channel socket connection
- Health check endpoint
- Message handling loop
- Quadlet unit format

**Step 2: Create template files**

Use `TEMPLATE` as placeholder in all names. The `service_scaffold` tool (in bloom-services) will do find-and-replace when generating.

Template should include:
- Health check HTTP server on configurable port
- Channel socket client (connect to `$XDG_RUNTIME_DIR/bloom/channels.sock`)
- JSON-newline protocol helpers
- Graceful shutdown handling
- Stubbed `transport.ts` with `send()` and `receive()` functions
- Basic test skeleton

**Step 3: Commit**

```bash
git add services/_template/
git commit -m "feat(services): add scaffold template for new services"
```

---

## Phase 4: Final Verification

### Task 19: Full verification and cleanup

**Step 1: Run full test suite**

Run: `npm test`
Expected: ALL PASS

**Step 2: Run Biome**

Run: `npm run check`
Expected: No new errors

**Step 3: Run build**

Run: `npm run build`
Expected: Clean compilation

**Step 4: Verify no leftover files**

Check that no old single-file extensions remain:
```bash
ls extensions/*.ts  # Should find nothing (or only a barrel if needed)
```

Check that old lib files are gone:
```bash
ls lib/audit-utils.ts lib/service-utils.ts lib/manifest.ts  # All should be missing
```

**Step 5: Final commit**

```bash
git add -A
git commit -m "refactor: complete architecture migration (extensions dirs, lib capabilities, service template)"
```
