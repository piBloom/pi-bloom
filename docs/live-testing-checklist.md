# Live Testing Checklist

Audience: operators validating a fresh NixPI image on real hardware or a realistic VM.

## Why This Checklist Exists

This is the acceptance checklist for first real NixPI runs.

Use it to verify that setup, messaging, and recovery paths still match the shipped documentation.

## How To Run The Check

### Clean Install

1. Install the image from a freshly built artifact.
2. Boot the machine and confirm login works on the local console.
3. Verify the first-login wizard starts automatically.

For VM validation:

- Use `just vm-install-iso` when the host bridge is configured.
- The launcher auto-detects a usable host bridge and fails clearly if none exists.
- Use it to validate installer flow, desktop startup, and real mesh reachability.
- Once NetBird is connected, the advertised service URLs should be reachable from any other NetBird peer.

### First Boot

1. Complete the password step.
2. Bring the machine online and confirm outbound network access works.
3. Enroll NetBird and verify `netbird status` reports a connected session.
4. Complete the Matrix step and confirm `~/.pi/matrix-credentials.json` exists.
5. Reboot once before finishing release notes.

Expected result:
Pi resumes cleanly after reboot and does not require manual cleanup of partial wizard state.

### Core Runtime

1. Confirm `nixpi-daemon.service` is active as a system service.
2. Confirm `continuwuity.service` is active.
3. Verify the `#general:nixpi` room exists and Pi replies to a message.
4. If agent overlays exist, confirm malformed overlays are skipped without killing the daemon.

### Recovery Cases

1. Interrupt the wizard during Matrix setup, log back in, and confirm setup resumes instead of re-registering from scratch.
2. Corrupt `~/nixpi/guardrails.yaml` and confirm NixPI falls back to the packaged defaults instead of crashing the session startup path.

## Reference

Ship gate:

- first-boot completes on a clean machine
- one reboot cycle preserves expected state
- Matrix messaging works end to end
- known risks for any optional packaged workloads are documented

## Related

- [operations/first-boot-setup.md](operations/first-boot-setup.md)
- [operations/quick-deploy.md](operations/quick-deploy.md)
