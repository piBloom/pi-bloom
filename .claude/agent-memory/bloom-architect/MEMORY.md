# Bloom Architect Memory

## Last Full Review
- Date: 2026-03-06, Commit: 254c237 (main)
- Overall: Healthy with targeted improvements
- Plan file: `.claude/plans/jazzy-zooming-marshmallow-agent-a9c9058de69e42bee.md`

## Critical Findings

### I-1: bloom-os.ts monolith (1530 lines, 18 tools)
- Mixes bootc, containers, systemd, repo mgmt, manifest in one file
- Should split into 3+ modules or extract domain logic to lib/

### I-2: Duplicated utilities across bloom-os.ts and bloom-services.ts
- `run()`, `hasSubidRange()`, `commandMissingError()`
- Extract to `lib/exec-utils.ts` and `lib/service-utils.ts`

### I-3: No test coverage for extension tool execution
- vitest.config.ts coverage only includes `lib/**/*.ts` (98.6% coverage)
- Extensions 0% coverage -- 35 tools untested directly

### I-5: Module-level singleton index in bloom-objects.ts:37
- `const index: Map` outside closure -- stale across reloads
- Move inside `export default function`

## Pi SDK Import Clarification
- CLAUDE.md says "never import at runtime" -- this is MISLEADING
- `StringEnum`, `Type`, `truncateHead` are VALUE exports requiring runtime import
- They are peerDependencies resolved by Pi -- architecturally correct
- Recommendation: clarify CLAUDE.md guidance (see plan rec #11)

## Architecture Patterns
- lib/ layer is genuinely pure (no side effects) -- good domain core
- Extensions lack port/adapter separation -- directly call fs, execFile, net
- Cross-extension coupling is low (communicate via Pi events only)
- Shared env var `_BLOOM_DIR_RESOLVED` is the only cross-extension state

## Testing Patterns
- `tests/helpers/temp-garden.ts` -- creates temp dir, saves/restores env vars
- `tests/helpers/mock-extension-api.ts` -- mock with _registeredTools, fireEvent
- Vitest with v8 coverage, 80% threshold on lib/
- All 183 tests pass consistently, no flaky tests observed

## Service Quadlet Notes
- bloom-whisper.container MISSING `[Install]` section (won't auto-start)
- All others have WantedBy=default.target
- whatsapp uses semver tag 0.1.0 (not pinned digest like others)

## Code Style Notes
- bloom-persona uses `console.error` instead of `createLogger()` -- inconsistent
- 3 extensions use `createRequire` hack for js-yaml (CJS in ESM project)
- Biome has 7 warnings (unused imports in test files)
- `check` script in package.json lists files explicitly (fragile)
