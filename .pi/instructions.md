# nixpi Repository Rules

NixPi is Nazar's private web interface for Pi Coding Agent.

## Goals

- Keep the core behavior as a thin Pi RPC bridge: browser ⇄ WebSocket ⇄ nixpi ⇄ `pi --mode rpc`.
- Keep the project lightweight: vanilla browser UI, Express, no build step for the app runtime.
- Prefer Nix/NixOS integration for infrastructure deployments.
- Preserve WireGuard/private-network assumptions in deployment docs; do not add public exposure by default.

## Before committing

- [ ] No secrets, API keys, WireGuard private keys, or private DAV credentials.
- [ ] UI, package metadata, CLI, and docs use NixPi/Nazar names.
- [ ] `node --check server.js` passes.
- [ ] If Nix packaging changed, `nix build .#nixpi` or `nix flake check --no-build` has been run.

## Nazar integration boundary

NixPi may be installed on `nazar` and in MicroVMs, but host networking, public exposure, WireGuard peers, VMID/IP/MAC/resource allocation, and fleet deploy policy remain owned by the `nazar` infrastructure repository.
