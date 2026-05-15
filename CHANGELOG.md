# nixpi Changelog

All notable changes to this project will be documented here.

## Unreleased

### Changed

- Removed the macOS-only `nixpi.sh` helper; use the NixOS module or `make dev` / `make start`.
- Split session and workspace handling out of `server.js` into focused modules.
- Split the browser UI into `public/index.html`, `public/style.css`, and `public/app.js`.
- Started the design-system migration with production `ds-button` and `ds-avatar` web components for topbar, mobile sidebar, status-banner, sidebar utility, and modal close actions.
- Switched Whisper uploads to Node 22 built-in `fetch`, `FormData`, and `Blob`.

### Removed

- Removed unused `node-fetch` and `form-data` dependencies.

## [1.6.3] - 2026-05-13

### Added

- Support serving NixPi behind a `/nixpi/` reverse-proxy path, including relative bundled JS paths, WebSocket URL selection, and API requests.
- Document the preferred Nazar routing model: `/nixpi/` on existing private service domains, with dedicated `nixpi*.nazar.studio` names as optional direct routes.

## [1.6.2] - 2026-05-13

### Changed

- Rebranded the project from `wgnr-pi` to `nixpi` for Nazar use.
- Renamed the CLI to `nixpi` and the macOS helper to `nixpi.sh`.
- Renamed configuration variables to `NIXPI_*`.
- Replaced public-facing UI and docs branding with NixPi/Nazar language.

### Added

- Nix flake package export for `nixpi`.
- Reusable NixOS service module at `nixosModules.nixpi`.

## Pre-NixPi upstream baseline

This repository started from the MIT-licensed `wgnr-pi` 1.6.1 codebase, which already provided the Pi RPC bridge, browser WebSocket streaming, session management, model picker, thinking controls, image support, slash commands, session export, and optional Whisper speech-to-text.
