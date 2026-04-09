# Live Testing

> Validating a fresh NixPI release against the canonical headless VPS install path

## Audience

Operators validating a fresh NixPI release on a headless x86_64 VPS.

## Why This Checklist Exists

Use it to verify that the retained install path, the shell-first Pi runtime, and the host-owned bootstrap workflow still match the shipped docs.

## Canonical Install Validation

1. Start from a fresh OVH VPS in rescue mode.
2. Run `nix run .#nixpi-deploy-ovh -- ...`.
3. Confirm `nixos-anywhere` installs the `ovh-vps-base` provisioner preset.
4. Reconnect and run `nixpi-bootstrap-host` on the machine.
5. Reboot once and confirm the same headless operator flow still works.

This is the supported base install then bootstrap flow.

If the provider reorders disks after kexec, validate the temporary installer's `/dev/disk/by-id` mapping before the destructive `disko` phase and resume the install with the verified installer-side target disk ID.

If KVM hangs at SeaBIOS `Booting from Hard Disk...` after an apparently successful install, fail the release check and confirm the deployed image was built from the hybrid BIOS+EFI OVH disk layout.

If the machine reappears in the OVH rescue environment after reboot, fail the release check and verify the provider boot mode was switched back from rescue to normal disk boot.

Confirm the administrative path works only from the configured SSH allowlist and that recovery remains an OVH console/rescue operation.

## First Remote Validation

1. Confirm `nixpi-app-setup.service`, `sshd.service`, and `nixpi-update.timer` reach their expected state.
2. Confirm `pi` works from SSH.
3. Confirm `sshd -T` reports key-only SSH with root login disabled.
4. Confirm `nft list ruleset` scopes port `22` to the configured admin CIDRs.
5. Confirm `sudo nixpi-rebuild` rebuilds the host-owned `/etc/nixos` tree.

**Expected result:** the Pi runtime returns after reboot, the host remains operable without repo-seeding or machine-root replacement, and no second install path is needed for recovery.

## Core Runtime

1. Confirm `pi --help` works.
2. Verify `pi` is usable from SSH.
3. Confirm the deployed host mode comes from NixOS config rather than user-home markers.
4. If agent overlays exist, confirm malformed overlays are skipped without breaking Pi availability.

## Reference

### Ship Gate

- The `nixpi-deploy-ovh` install completes on a clean headless VPS.
- The base install is followed by `nixpi-bootstrap-host` on the machine.
- No first boot step relies on repo seeding or a deleted direct-install wrapper.
- The shell-first Pi runtime works from SSH.
- One reboot cycle preserves the expected operator workflow.
- The installed `/etc/nixos` flake remains the steady-state source of truth.
- Known risks for any optional packaged workloads are documented.
