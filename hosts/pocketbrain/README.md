# pocketbrain host config snapshot

This directory mirrors the currently deployed `/etc/nixos` host files from `pocketbrain`.

## Files

- `flake.nix`
- `flake.lock`
- `configuration.nix`
- `hardware-configuration.nix`
- `nixpi-integration.nix`
- `nixpi-host.nix`

## Notes

- Keep secrets out of these files (private keys, tokens, passwords).
- SSH public keys and firewall CIDRs are expected in `nixpi-host.nix`.
