# Live Testing

> Validating a fresh NixPI release against the canonical headless VPS install path

## Audience

Operators validating a fresh NixPI release on a headless x86_64 VPS.

## Why This Checklist Exists

Use it to verify that the retained `nixos-anywhere` install path, the shell-first Pi runtime, and the canonical `/srv/nixpi` workflow still match the shipped docs.

## Canonical Install Validation

1. Start from a fresh OVH VPS in rescue mode.
2. Run `nix run .#nixpi-deploy-ovh -- ...`.
3. Confirm first boot seeds `/srv/nixpi`, initializes `/etc/nixos/flake.nix`, and reaches the expected service state.
4. Reboot once and confirm the same `/srv/nixpi` + `nixpi-rebuild` workflow still works.

## First Remote Validation

1. Confirm `nixpi-app-setup.service`, `sshd.service`, `wireguard-wg0.service`, and `nixpi-update.timer` reach their expected state.
2. Confirm `pi` works from SSH.
3. Confirm outbound networking works and add at least one WireGuard peer before treating the host as ready for routine remote use.
4. Reboot once and repeat the shell-access checks.

**Expected result:** the Pi runtime returns after reboot, the system remains operable from the canonical checkout, and no second install path is needed for recovery.

## Core Runtime

1. Confirm `~/.pi/settings.json` exists for the primary operator.
2. Confirm `pi --help` works.
3. Verify `pi` is usable from SSH.
4. If agent overlays exist, confirm malformed overlays are skipped without breaking Pi availability.

## Reference

### Ship Gate

- The `nixpi-deploy-ovh` install completes on a clean VPS.
- `/srv/nixpi` is present and usable for rebuilds after first boot.
- The shell-first Pi runtime works from SSH.
- One reboot cycle preserves the expected operator workflow.
- Known risks for any optional packaged workloads are documented.
