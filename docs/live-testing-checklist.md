# Live Testing Checklist

Audience: operators validating a fresh NixPI image on real hardware or a realistic VM.

## Why This Checklist Exists

This is the acceptance checklist for first real NixPI runs.

Use it to verify that setup and local chat behavior still match the shipped documentation.

## How To Run The Check

### Clean Install

1. Install the image from a freshly built artifact.
2. Boot the machine and confirm login works on the local console.
3. Verify the first-login wizard starts automatically.

For VM validation:

- Use it to validate installer flow, desktop startup, and the local chat/runtime path inside the guest.
- Treat any host-side forwards as optional debugging aids, not part of the active local-only test path.

### First Boot

1. Complete the password step.
2. Bring the machine online and confirm outbound network access works.
3. Complete the local chat step and confirm the Pi Web Chat surface becomes reachable on `http://localhost:8080/`.
4. Reboot once before finishing release notes.

Expected result:
Pi resumes cleanly after reboot and does not require manual cleanup of partial wizard state.

### Core Runtime

1. Confirm `nixpi-chat.service` is active.
2. Verify the local web chat loads and Pi replies to a message.
3. If agent overlays exist, confirm malformed overlays are skipped without breaking chat availability.

## Reference

Ship gate:

- first-boot completes on a clean machine
- one reboot cycle preserves expected state
- Local web chat works end to end
- known risks for any optional packaged workloads are documented

## Related

- [operations/first-boot-setup.md](operations/first-boot-setup.md)
- [operations/quick-deploy.md](operations/quick-deploy.md)
