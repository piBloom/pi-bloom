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
- [ ] If Nix packaging changed, `nix build .#nixpi-bun` or `nix flake check --no-build` has been run.

## Nazar integration boundary

NixPi production runs on `nazar` through the reusable NixOS module/package. VM work happens through SSH workspaces, not per-VM NixPi HTTP services. Host networking, public exposure, private access, VMID/IP/MAC/resource allocation, and fleet deploy policy remain owned by the `nazar` infrastructure repository.
