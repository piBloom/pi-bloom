# Repository Guidelines

## Project Structure & Module Organization
- `core/lib/`: shared TypeScript utilities for exec, filesystem, frontmatter, logging, and validation.
- `core/pi/extensions/`: Pi extension entry points and action modules (`persona`, `os`, `objects`, `episodes`, `nixpi`).
- `core/os/`: NixOS modules, package definitions, host profiles, and deployment helpers.
- `core/scripts/`: operational shell scripts such as `nixpi-rebuild.sh`.
- `tests/`: Vitest suites split by scope (`lib`, `extensions`, `integration`, `e2e`, `os`) plus NixOS fixtures in `tests/nixos/`.
- `docs/`: VitePress site content; `internal/` holds maintainer-only notes.

## Build, Test, and Development Commands
- `npm run build` — compile TypeScript to `dist/` with `tsc --build`.
- `npm test` — run the full Vitest suite.
- `npm run test:coverage` — collect V8 coverage and enforce thresholds.
- `npm run test:system:smoke` — run the fast NixOS smoke check.
- `npm run check` — run Biome formatting and lint checks.
- `npm run check:fix` — auto-apply Biome fixes.
- `npm run docs:dev` — serve the documentation site locally.

## Coding Style & Naming Conventions
Use TypeScript ESM with tabs for indentation, double quotes, semicolons, and LF line endings; Biome enforces this (`biome.json`). Keep modules focused and prefer named exports. Match existing file patterns: kebab-case for Nix files (`ovh-base.nix`), descriptive action files (`actions-health.ts`), and `*.test.ts` for tests.

## Testing Guidelines
Vitest runs in a Node environment and discovers `tests/**/*.test.ts`. Keep unit tests near their domain folder under `tests/`, and place broader workflow checks in `tests/integration/` or `tests/e2e/`. Coverage thresholds are enforced for `core/lib/**/*.ts` and `core/pi/extensions/**/*.ts`; do not lower them without justification.

## Commit & Pull Request Guidelines
Recent history uses short, imperative, outcome-first subjects such as `Make OVH deploy verification deterministic...`. Keep that style. When committing, follow the repository's Lore protocol: a why-focused subject, a short rationale body, and git trailers like `Constraint:`, `Confidence:`, and `Tested:`. PRs should summarize intent, list verification commands run, link related issues/specs, and include screenshots only for docs or UI-visible changes.

## Security & Configuration Tips
Do not commit secrets, generated `dist/` output, or machine-specific state. Treat NixOS and deployment edits as high impact: mention target hosts/modules in the PR and prefer `npm run test:system:smoke` before broader system checks.
