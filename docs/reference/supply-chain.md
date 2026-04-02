# Supply Chain

> Image trust and dependency policy

## Supply Chain Notes

NixPI relies on Nix inputs and Nixpkgs packages for its built-in service surface.

The important supply-chain boundary is:

- `flake.nix` inputs
- The selected Nixpkgs revision
- NixPI's own source tree

Built-in services such as `nixpi-chat`, the local web chat on `:8080`, and the Pi runtime packages are provisioned from those sources rather than from a mutable runtime package catalog.

## Dependency Sources

| Source | Purpose |
|--------|---------|
| `nixpkgs` | System packages, services |
| `NixPI source` | Modules, extensions, daemon |
| `npm registry` | Node.js dependencies (locked) |

## 🔒 Trust Model

1. Nixpkgs revision is pinned in `flake.lock`
2. npm dependencies are resolved from `package.json` version constraints
3. The Nixpkgs `flake.lock` is committed; npm lockfiles are generated artifacts and excluded from version control
4. Review changes to `flake.lock` and `package.json` version pins as part of normal PR review

## Related

- [Security Model](./security-model)
