# Live Testing Checklist

> 📖 [Emoji Legend](LEGEND.md)

Use this checklist for the first real Bloom run on a mini PC or other fresh machine.

## Clean Install

1. Install the image from a freshly built artifact.
2. Boot the machine and confirm login works on the local console.
3. Verify the first-login wizard starts automatically.

## First Boot

1. Complete the password step.
2. Bring the machine online and confirm outbound network access works.
3. Enroll NetBird and verify the reported mesh IP is reachable from another peer.
4. Complete the Matrix step and confirm `~/.pi/matrix-credentials.json` exists.
5. Reboot once before finishing release notes.

Expected result:
Pi resumes cleanly after reboot and does not require manual cleanup of partial wizard state.

## Core Runtime

1. Confirm `pi-daemon.service` is active in the user session.
2. Confirm `bloom-matrix.service` is active.
3. Verify the `#general:bloom` room exists and Pi replies to a message.
4. If agent overlays exist, confirm malformed overlays are skipped without killing the daemon.

## Service Lifecycle

1. Run `manifest_show` and confirm the manifest is readable.
2. Install one packaged service with `service_install`.
   For `dufs`, confirm it serves only `~/Public/Bloom`, not the full home directory.
3. Run `manifest_apply` twice in a row and confirm the second run is boring.
4. Disable a service in the manifest and confirm it stops cleanly.
5. If a socket-activated service exists, confirm Bloom starts the socket unit rather than forcing the service unit.

## Recovery Cases

1. Interrupt the wizard during Matrix setup, log back in, and confirm setup resumes instead of re-registering from scratch.
2. Force one service dependency failure and confirm the requested primary service is not partially installed.
3. Corrupt `~/Bloom/manifest.yaml` and confirm Bloom quarantines it and recreates an empty manifest.

## Ship Gate

Do not call the build release-ready until all of these are true:

- first-boot completes on a clean machine
- one reboot cycle preserves expected state
- Matrix messaging works end to end
- service install/apply/disable works without manual cleanup
- the known risks for any optional service defaults are documented
