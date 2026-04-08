# TTYD + Pi Terminal Surface Design

## Goal

Replace the current browser chat-first surface with a terminal-first NixPI surface where the browser opens into ttyd, Pi is the primary user interface, and the same Pi-guided setup/steady-state experience works from ttyd, SSH, or a local terminal.

## Why this change

The old browser app duplicated interaction models and pulled too much logic into the browser. The desired direction is more NixOS-native and more aligned with Pi's design philosophy: Pi should be the real interface, terminal transport should stay simple, and the browser should just expose a terminal conveniently.

Research notes:
- `pi-mono` describes Pi as a “minimal terminal coding harness” that is intended to be adapted with extensions, skills, and prompt templates rather than wrapped in heavyweight product logic. Source: https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md
- Pi exposes lifecycle hooks like `session_start`, `before_agent_start`, `input`, `tool_call`, and `model_select`, which are the correct surface for setup gating and guidance. Source: https://pt-act-pi-mono.mintlify.app/api/coding-agent/hooks
- Pi's terminal docs reinforce that terminal integration should remain terminal-native rather than reimplemented in a browser UI. Source: https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/terminal-setup.md

## Product model

There is one primary user-facing surface:

- ttyd in the browser, filling the whole page

There is one primary interaction model:

- Pi in the terminal

There are two behavioral modes:

1. **Setup mode** — `~/.nixpi/wizard-state/system-ready` does not exist
2. **Normal mode** — `~/.nixpi/wizard-state/system-ready` exists

The browser no longer needs its own setup wizard UI or browser chat UI. Setup and steady-state use the same terminal-first surface; only Pi's behavior changes based on setup state.

## Desired user experience

### Browser entry

When the user opens localhost or the canonical web entry point:
- they should land in a full-window ttyd session
- no chat panel, split layout, progress rail, or onboarding chrome should be shown
- ttyd is just the easiest browser transport for Pi, not a separate application mode

### Pi startup flow

On terminal startup:
- the shell session should immediately guide the user into Pi
- `pi` should be prefilled or launched in the terminal-oriented way the repo can support safely
- the first interaction should be `/login`, then `/model`

The user explicitly chose prefill/open behavior closer to “normal shell plus Pi bootstrapped quickly” rather than a separate browser wizard.

### Setup mode behavior

When `system-ready` is missing, Pi should act as the setup copilot.

The setup sequence is:
1. ensure Pi is active
2. complete `/login`
3. complete `/model`
4. guide Git identity setup for work in `/srv/nixpi`
5. guide WireGuard configuration
6. guide OS security configuration
7. guide the NixPI introduction/tutorial
8. write the final `system-ready` marker only when the whole flow is complete

### Normal mode behavior

When `system-ready` exists:
- Pi should start normally
- no setup gating should run
- the browser still opens the same ttyd-based terminal surface

### Access parity

The same setup should also work from:
- SSH
- a local tty/login shell
- ttyd in the browser

The browser should not become a separate logic path with different onboarding semantics.

## State model

### Final gate

Reuse the existing file:
- `~/.nixpi/wizard-state/system-ready`

Its meaning changes from an earlier setup milestone to:
- **the full Pi-guided onboarding is complete**

### Keep state minimal

Do not build a large frontend onboarding state machine.

Persistent browser/UI state should stay minimal. Pi and the filesystem should own progression. If intermediate progress is needed, it should be represented in simple inspectable files under the existing NixPI state model, but the hard gate remains `system-ready`.

## Architecture

### Remove the chat-first webapp path

The old stack included:
- a browser frontend
- a Node browser runtime
- a dedicated browser-app system service
- nginx routing `/` to that runtime and `/terminal` to ttyd

This should be simplified so the canonical browser surface becomes ttyd-first.

Preferred implementation direction:
- make `/` resolve directly to ttyd instead of the chat frontend
- remove chat-specific browser/backend responsibilities from the critical path
- preserve only the minimal packaging and NixOS service wiring needed for a terminal-first Pi surface

This is more NixOS-native because nginx and systemd are just wiring browser transport to a terminal service rather than hosting a custom browser application unnecessarily.

### Pi-guided setup belongs in Pi extensions/skills

Per the Pi docs, the right place for setup-mode logic is in Pi itself:
- use extensions/hooks for mode detection and startup behavior
- use skills/prompting for the actual setup guidance
- keep the browser transport dumb

That means:
- detect setup mode in Pi extensions
- inject setup-mode system prompt or startup guidance with `before_agent_start` / `session_start`
- steer the user through the setup using Pi-native prompts/skills
- let Pi verify milestones with shell/tool checks

### ttyd launch behavior

Current ttyd runs bash directly. To support the desired flow, ttyd should launch a shell/session path that quickly enters Pi in a transport-neutral way.

Implementation should prefer one of these NixOS-native patterns:
1. a dedicated wrapper command used by ttyd and optionally by login shells
2. shell init/profile logic scoped to the NixPI user/session when appropriate

Prefer a wrapper command because it is explicit, testable, and does not globally mutate unrelated shell behavior.

## Non-goals

- no separate browser setup wizard UI
- no side panel or split-pane onboarding shell
- no continuation of the current browser chat experience for now
- no complex frontend state machine
- no transport-specific setup flow that only works in ttyd

## Files and subsystems likely affected

### Browser / server surface
- the removed browser runtime path
- `core/os/modules/service-surface.nix`
- `core/os/modules/app.nix`
- `core/os/pkgs/app/default.nix`

### ttyd / shell startup
- `core/os/modules/ttyd.nix`
- new wrapper script/package for ttyd session bootstrap
- maybe app setup logic in `core/os/modules/app.nix`

### Pi setup behavior
- `core/pi/extensions/persona/*`
- `core/pi/extensions/nixpi/*`
- `core/pi/skills/first-boot/SKILL.md`
- potentially a new setup-specific skill or prompt path for pre-`system-ready` operation

### Tests and docs
- retired browser-runtime tests
- `tests/nixos/nixpi-chat.nix`
- `tests/nixos/nixpi-firstboot.nix`
- `tests/nixos/nixpi-vps-bootstrap.nix`
- `tests/nixos/nixpi-e2e.nix`
- operator docs in `README.md`, `docs/operations/*`

## Verification expectations

The redesign is correct when:
1. browser access opens ttyd as the primary surface
2. Pi setup behavior appears automatically when `system-ready` is missing
3. Pi normal behavior appears when `system-ready` exists
4. the same setup semantics work from ttyd and shell-based access paths
5. no stale chat-first assumptions remain in docs or tests for the main product path

## Risks

- chat-specific code and tests are currently deeply wired into app packaging and system checks
- `system-ready` currently means an earlier milestone, so semantics must be updated consistently
- ttyd auto-start/prefill behavior must not become brittle or transport-specific
- removing the browser app path may require revisiting nginx, packaging, and smoke tests together

## Recommended implementation direction

Build this in the most NixOS- and Pi-native way possible:
- prefer declarative systemd/nginx/ttyd wiring over custom browser logic
- prefer Pi extensions/skills/hooks over external orchestration UIs
- prefer explicit wrapper scripts and inspectable filesystem markers over hidden in-memory UI state
- keep browser transport simple and let Pi own the experience
