# NixPi Bun UI Migration Plan

Goal: make the browser UI as native as practical: static files under `public/`, vanilla JavaScript, pure autonomous Web Components, safe DOM APIs, and no Lit/design-system build pipeline.

## Guardrails

- Keep production runtime simple: static files under `public/`, loaded by `public/index.html`.
- Treat `public/ds/topbar-actions.js` and future `public/ds/*.js` modules as the canonical component source.
- Do not reintroduce Lit, decorators, or a TypeScript-only design-system source tree unless there is a concrete need.
- Keep chat markdown routed through `md()` and the explicit sanitizer/fallback boundary.
- Preserve WebSocket/session orchestration in `public/app.js` until there is a tested store.
- Prefer small, deployable slices with `make smoke`, `nix build .#nixpi-bun --no-link`, and live smoke on Nazar.

## Current status

- Production components are already native custom elements: `ds-button`, `ds-input`, `ds-session-item`, and `ds-avatar`.
- The old Lit `design-system/` tree has been removed from this fork.
- Markdown now uses a small native safe subset and does not load `marked` or `DOMPurify` at runtime.

## Next phases

### 1. Split production components

Move the growing `public/ds/topbar-actions.js` bundle into focused modules while keeping native custom elements and no build step.

### 2. Reduce browser dependencies carefully

Expand the current tiny safe Markdown subset only when the feature can be implemented with escaped text, safe URLs, and smoke coverage. Avoid raw HTML support.

### 3. Remove CDN dependencies optionally

Tailwind CDN, Google Fonts, and Material Symbols are outside npm. Replacing them with local static CSS/fonts/icons is orthogonal to Bun but aligns with offline/private NixOS deployment.

### 4. Add characterization tests

Expand `scripts/smoke-ui.js` around markdown safety, custom-element behavior, WebSocket status messages, and reverse-proxy subpath behavior before larger UI rewrites.
