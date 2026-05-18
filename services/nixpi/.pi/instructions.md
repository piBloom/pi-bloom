# nixpi-bun Repository Rules

NixPi Bun is Nazar's Bun-native Pi RPC web interface.

## Goals

- Keep the core behavior as a thin Pi RPC bridge: browser ⇄ WebSocket ⇄ nixpi-bun ⇄ `pi --mode rpc`.
- Keep the project lightweight: Bun runtime, vanilla browser UI, native Web Components, and minimal build steps.
- Prefer Nix/NixOS integration for infrastructure deployments.
- Preserve sshuttle/private-network assumptions in deployment docs; do not add public exposure by default.

## Before committing

- [ ] No secrets, API keys, SSH/private-network keys, or private DAV credentials.
- [ ] UI, package metadata, CLI, and docs use NixPi Bun/Nazar names where this fork diverges.
- [ ] `node --check server.js` passes for syntax and Bun smoke testing has been attempted when Bun is available.
- [ ] If Nix packaging changed, run root-flake validation such as `nix build ../..#nixpi-bun --no-link` from this directory or `nix flake check ../.. --no-build`.

## Nazar integration boundary

NixPi production runs on `nazar` through the reusable NixOS module/package imported by the root flake. Host networking, public exposure, private access, and deployment policy remain owned by the `nazar` infrastructure repository.
