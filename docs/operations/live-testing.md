# Live Testing

> Validating a fresh NixPI release against the canonical headless VPS install path

## Audience

Operators validating a fresh NixPI release on a headless x86_64 VPS.

## Why This Checklist Exists

Use it to verify that the retained `nixos-anywhere` install path, the shell-first Pi runtime, and the optional operator checkout workflow still match the shipped docs.

## Canonical Install Validation

1. Start from a fresh OVH VPS in rescue mode.
2. Run `nix run .#nixpi-deploy-ovh -- ...`.
3. Confirm `nixos-anywhere` installs the final `ovh-vps` host configuration directly and reaches the expected service state.
4. Reboot once and confirm the same headless operator flow still works.

## First Remote Validation

1. Confirm `nixpi-app-setup.service`, `sshd.service`, `wireguard-wg0.service`, and `nixpi-update.timer` reach their expected state.
2. Confirm `pi` works from SSH.
3. Confirm outbound networking works and add at least one WireGuard peer before treating the host as ready for routine remote use.
4. If you keep an operator checkout such as `/srv/nixpi`, confirm it remains usable for rebuilds after reboot.

**Expected result:** the Pi runtime returns after reboot, the host remains operable without first-boot repo seeding or runtime host-flake generation, and no second install path is needed for recovery.

## Core Runtime

1. Confirm `pi --help` works.
2. Verify `pi` is usable from SSH.
3. Confirm the deployed host mode comes from NixOS config rather than user-home markers.
4. If agent overlays exist, confirm malformed overlays are skipped without breaking Pi availability.

## Reference

### Ship Gate

- The `nixpi-deploy-ovh` install completes on a clean headless VPS.
- No first boot step seeds `/srv/nixpi` or creates `/etc/nixos/flake.nix` at runtime as part of install convergence.
- The shell-first Pi runtime works from SSH.
- One reboot cycle preserves the expected operator workflow.
- Optional operator checkouts such as `/srv/nixpi` remain usable for rebuilds when present.
- Known risks for any optional packaged workloads are documented.
