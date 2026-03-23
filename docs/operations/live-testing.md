# Live Testing

> Validating a fresh NixPI release

## 🌱 Audience

Operators validating a fresh NixPI image on real hardware or a realistic VM.

## 🌱 Why This Checklist Exists

This is the acceptance checklist for first real NixPI runs.

Use it to verify that setup, messaging, and recovery paths still match the shipped documentation.

## 🚀 How To Run The Check

### Clean Install

1. Install the image from a freshly built artifact
2. Boot the machine and confirm login works on the local console
3. Verify the first-login wizard starts automatically

For VM validation:

- Use `just vm-install-iso` for the default local-dev path
- Use `NIXPI_INSTALL_VM_BRIDGE=br0 just vm-install-iso-bridge` when you need to verify NetBird and service reachability from outside the guest
- Do not expect guest NetBird URLs in the default NAT path to behave like a real network peer

### First Boot

1. Complete the password step
2. Bring the machine online and confirm outbound network access works
3. Enroll NetBird and verify the reported mesh IP is reachable from another peer
4. Complete the Matrix step and confirm `~/.pi/matrix-credentials.json` exists
5. Reboot once before finishing release notes

**Expected result**: Pi resumes cleanly after reboot and does not require manual cleanup of partial wizard state.

### Core Runtime

1. Confirm `nixpi-daemon.service` is active as a system service
2. Confirm `continuwuity.service` is active
3. Verify the `#general:nixpi` room exists and Pi replies to a message
4. If agent overlays exist, confirm malformed overlays are skipped without killing the daemon

### Recovery Cases

1. Interrupt the wizard during Matrix setup, log back in, and confirm setup resumes instead of re-registering from scratch
2. Corrupt `~/nixpi/guardrails.yaml` and confirm NixPI falls back to the packaged defaults instead of crashing the session startup path

## 📚 Reference

### Ship Gate

- First-boot completes on a clean machine
- One reboot cycle preserves expected state
- Matrix messaging works end to end
- Known risks for any optional packaged workloads are documented

## 🔗 Related

- [First Boot Setup](./first-boot-setup)
- [Quick Deploy](./quick-deploy)
