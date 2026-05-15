# NixPi UI Migration Plan

Goal: migrate the browser UI toward `ds-*` web components and safe DOM APIs without adding an unnecessary production build pipeline or weakening the current markdown sanitizer boundary.

## Guardrails

- Keep production runtime simple: static files under `public/`, loaded by `public/index.html`.
- Treat `public/ds/topbar-actions.js` as the production component bundle for now.
- Treat `design-system/src/**` as reference/source until a real bundling/copy pipeline exists.
- Do not import Lit/source-only design-system modules directly into production pages.
- Keep chat markdown routed through `md()` and DOMPurify; do not adopt `unsafeHTML(simpleMd())` for production chat.
- Preserve websocket/session orchestration in `public/app.js` until there is a tested store.
- Prefer small, deployable slices with `make check`, `nix build .#nixpi --no-link`, headless smoke, and live smoke after Nazar lock updates.

## Phases

### 1. Remove remaining unsafe static scaffolding

- Rewrite `addMsg()` message wrappers with DOM APIs.
- Rewrite `ensureAssistantMsg()` and `ensureThinking()` static markup with DOM APIs.
- Keep markdown insertion as an explicit sanitizer boundary.
- Harden history replay so assistant text is not treated as trusted raw HTML.

Acceptance:

- No `wrapper.innerHTML` remains in message scaffolding.
- Thinking/tool-call streaming still works.
- User/system/error/assistant messages render as before.
- Remaining `innerHTML` use is only markdown insertion or deliberate library/native clearing exceptions.

### 2. Add minimal production components only where useful

- Add vanilla `ds-session-item` to `public/ds/topbar-actions.js` if session rows need component ownership.
- Keep rows accessible: real button semantics or explicit role/tabindex/keyboard support.
- Do not wrap file inputs or selects unless there is a concrete need.

Acceptance:

- Session switching works by mouse and keyboard.
- Session search/filter behavior still works.
- Obsolete `.session-item` CSS is removed only after parity.

### 3. Inputs last, native where better

- Consider a minimal `ds-input` only after value/focus/event proxying is proven.
- Migrate low-risk search inputs before the prompt textarea.
- Keep file input and workspace select native unless wrapping clearly simplifies the code.

Acceptance:

- `.value`, `.focus()`, `input/change`, keyboard, paste, and accessibility behavior are preserved.

### 4. Markdown sanitizer hardening

- Make `md()` safe when marked/DOMPurify fail to load. ✅
- Preserve link hardening (`target="_blank"`, `rel="noopener noreferrer"`). ✅
- Add focused hostile-markdown smoke checks before future sanitizer changes.

Acceptance:

- Normal markdown still works with libs loaded.
- Hostile HTML/script does not execute if sanitizer libraries fail.

### 5. Design-system alignment

- Backport stable production APIs to `design-system/src/**` after production behavior is proven. ✅
- Keep typecheck green. ✅
- Avoid large app-shell/sidebar/topbar rewrites until atoms/molecules are stable.

## Current status

- Phase 1 complete: message scaffolding uses DOM APIs and markdown is isolated behind `setMarkdown()`.
- Phase 2 complete: session rows use a minimal production `ds-session-item`.
- Phase 4 implementation complete: markdown falls back to escaped plaintext HTML if DOMPurify is unavailable; repo-local browser smoke tests are still future work.
- Phase 5 partially complete: source `ds-button`, `ds-input`, and `ds-session-item` align with the proven production APIs.
