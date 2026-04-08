# Live Testing

> Validating a fresh NixPI release against the supported bootstrap operator path

## Audience

Operators validating a fresh NixPI release on a NixOS-capable x86_64 VPS, headless VM, or mini PC.

## Why This Checklist Exists

This is the release-acceptance checklist for the current public deployment story.

Use it to verify that bootstrap, the Pi terminal surface, and the canonical `/srv/nixpi` workflow still match the shipped docs.

## How To Run The Check

### Fresh Bootstrap

1. Start from a fresh NixOS-capable x86_64 machine.
2. Run `nix run github:alexradunet/nixpi#nixpi-bootstrap-vps`.
3. Confirm the command prepares `/srv/nixpi`, initializes `/etc/nixos/flake.nix`, and completes `sudo nixos-rebuild switch --flake /etc/nixos#nixos`.

If you are validating a branch from a local checkout instead of GitHub, `nix run .#nixpi-bootstrap-vps` is the equivalent repo-local path.

### Stable Bootstrap Regression Gate

Before shipping bootstrap-related changes from a local checkout, verify both:

```bash
nix build .#checks.x86_64-linux.config-stable-bootstrap --no-link -L
nix build .#checks.x86_64-linux.nixpi-bootstrap-fresh-install-stable --no-link -L
```

These commands validate the same stable `nixos-25.11` bootstrap line that the generated `/etc/nixos/flake.nix` uses by default.

### Manual QEMU Lab

Scratch installer lab:

```bash
nix run .#qemu-installer
```

Reusable preinstalled stable disk:

```bash
nix run .#qemu-prepare-preinstalled-stable
nix run .#qemu-preinstalled-stable
```

These commands standardize the host-side QEMU environment only. Local runtime artifacts live under `qemu-lab/`. Install, bootstrap, reboot, and service validation remain manual inside the guest. See `tools/qemu/README.md` for the exact disk paths and scratch-to-reusable image flow.

### First Remote Validation

1. Confirm `nixpi-ttyd.service`, `nginx.service`, and `wireguard-wg0.service` reach their expected state.
2. Verify the public HTTP surface responds on `http://127.0.0.1/` and `http://127.0.0.1/terminal/`.
3. Confirm the same Pi workflow also works over SSH or a local terminal when needed.
4. Confirm outbound networking works and add at least one WireGuard peer before treating the host as ready for routine remote use.
5. Reboot once and repeat the public-surface checks.
6. On monitor-attached hardware, confirm the machine also presents a local `tty1` login prompt after reboot.

**Expected result:** the Pi terminal surface returns after reboot, the system remains operable from the canonical checkout without any separate local-session app flow, and monitor-attached mini PCs retain a local recovery console.

### Core Runtime

1. Confirm the Pi terminal loads on `/`.
2. Confirm `/terminal/` resolves to the same ttyd-backed terminal surface.
3. Verify `pi` is usable from ttyd, SSH, or a local shell.
4. If agent overlays exist, confirm malformed overlays are skipped without breaking Pi availability.

## Reference

### Ship Gate

- Fresh bootstrap completes on a clean host.
- `/srv/nixpi` is present and usable for rebuilds after install.
- The public Pi terminal surface works on `/` and `/terminal/`.
- One reboot cycle preserves the expected remote operator workflow.
- Known risks for any optional packaged workloads are documented.

## Related

- [First Boot Setup](./first-boot-setup)
- [Quick Deploy](./quick-deploy)
