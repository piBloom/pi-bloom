# Live Testing Checklist

> 📖 [Emoji Legend](LEGEND.md)

Audience: operators validating a fresh nixPI image on real hardware or a realistic VM.

## 🌱 Why This Checklist Exists

This is the acceptance checklist for first real nixPI runs.

Use it to verify that setup, messaging, and recovery paths still match the shipped documentation.

## 🚀 How To Run The Check

### Clean Install

1. Install the image from a freshly built artifact.
2. Boot the machine and confirm login works on the local console.
3. Verify the first-login wizard starts automatically.

### First Boot

1. Complete the password step.
2. Bring the machine online and confirm outbound network access works.
3. Enroll NetBird and verify the reported mesh IP is reachable from another peer.
4. Complete the Matrix step and confirm `~/.pi/matrix-credentials.json` exists.
5. Reboot once before finishing release notes.

Expected result:
Pi resumes cleanly after reboot and does not require manual cleanup of partial wizard state.

### Core Runtime

1. Confirm `pi-daemon.service` is active in the user session.
2. Confirm `matrix-synapse.service` is active.
3. Verify the `#general:workspace` room exists and Pi replies to a message.
4. If agent overlays exist, confirm malformed overlays are skipped without killing the daemon.

### Recovery Cases

1. Interrupt the wizard during Matrix setup, log back in, and confirm setup resumes instead of re-registering from scratch.
2. Corrupt `~/Workspace/guardrails.yaml` and confirm nixPI falls back to the packaged defaults instead of crashing the session startup path.

## 📚 Reference

Ship gate:

- first-boot completes on a clean machine
- one reboot cycle preserves expected state
- Matrix messaging works end to end
- known risks for any optional packaged workloads are documented

## 🔗 Related

- [first-boot-setup.md](first-boot-setup.md)
- [quick_deploy.md](quick_deploy.md)
