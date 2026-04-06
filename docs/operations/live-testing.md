# Live Testing

> Validating a fresh NixPI release against the supported bootstrap operator path

## Audience

Operators validating a fresh NixPI release on a NixOS-capable x86_64 VPS, headless VM, or mini PC.

## Why This Checklist Exists

This is the release-acceptance checklist for the current public deployment story.

Use it to verify that bootstrap, the remote app surface, and the canonical `/srv/nixpi` workflow still match the shipped docs.

## How To Run The Check

### Fresh Bootstrap

1. Start from a fresh NixOS-capable x86_64 machine.
2. Run `nix run github:alexradunet/nixpi#nixpi-bootstrap-vps`.
3. Confirm the command prepares `/srv/nixpi` and completes `sudo nixos-rebuild switch --flake /srv/nixpi#nixpi`.

If you are validating a branch from a local checkout instead of GitHub, `nix run .#nixpi-bootstrap-vps` is the equivalent repo-local path.

### First Remote Validation

1. Confirm `nixpi-chat.service`, `nixpi-ttyd.service`, `nginx.service`, and `netbird.service` reach their expected state.
2. Verify the public HTTP surface responds on `http://127.0.0.1/` and `http://127.0.0.1/terminal/`.
3. Use `http://127.0.0.1:8080/` only as the internal chat backend health probe when you need to distinguish backend availability from the public nginx surface.
4. Confirm outbound networking works and finish NetBird enrollment before treating the host as ready for routine remote use.
5. Reboot once and repeat the public-surface checks.
6. On monitor-attached hardware, confirm the machine also presents a local `tty1` login prompt after reboot.

**Expected result:** the remote app and browser terminal return after reboot, the system remains operable from the canonical checkout without any local-session setup flow, and monitor-attached mini PCs retain a local recovery console.

### Core Runtime

1. Confirm the remote app loads on `/`.
2. Confirm the browser terminal loads on `/terminal/`.
3. Verify the chat runtime replies to a basic message through the remote app.
4. If agent overlays exist, confirm malformed overlays are skipped without breaking chat availability.

## Reference

### Ship Gate

- Fresh bootstrap completes on a clean host.
- `/srv/nixpi` is present and usable for rebuilds after install.
- The public app surface works on `/` and `/terminal/`.
- The internal backend health probe on `127.0.0.1:8080` still responds when needed for debugging.
- One reboot cycle preserves the expected remote operator workflow.
- Known risks for any optional packaged workloads are documented.

## Related

- [First Boot Setup](./first-boot-setup)
- [Quick Deploy](./quick-deploy)
