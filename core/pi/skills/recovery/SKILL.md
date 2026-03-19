---
name: recovery
description: Troubleshooting and recovery procedures for common nixPI system issues
---

# Recovery Playbooks

Use these procedures when diagnosing and recovering from common system issues. Always start with `system_health` for an overview before diving into specific playbooks.

## Matrix Homeserver Issues

**Symptoms**: Messages not delivered, Pi not responding in Matrix rooms.

1. Check system health: `system_health`
2. Check Matrix service: `systemctl status matrix-synapse`
3. Check logs: `journalctl -u matrix-synapse -n 100`
4. Common causes:
   - Server not running: `sudo systemctl restart matrix-synapse`
   - Database corruption: check `/var/lib/continuwuity/` for issues
   - Port conflict: verify nothing else is on port 6167
5. If Pi is not responding to messages:
   - Check Pi agent is running and `pi-daemon.service` is active
   - Verify Pi's Matrix credentials at `~/.pi/matrix-credentials.json`

## OS Update Failure

**Symptoms**: Update failed, or system boots into old NixOS generation.

1. Check current generation: `nixos_update(action="status")`
2. If booted into wrong generation: `nixos_update(action="rollback")` to revert
3. If update failed: check the last update status file
4. Common causes:
   - Network interruption during build: retry `nixos_update(action="apply", source="remote")`
   - Evaluation error: check flake source for Nix errors
   - Disk full: check with `system_health`, run `nix-collect-garbage`
5. After rollback: confirm with `nixos_update(action="status")`

## Local Nix Proposal Failure

**Symptoms**: Local repo changes fail validation before review or switch.

1. Check local proposal state: `nix_config_proposal(action="status")`
2. Run validation: `nix_config_proposal(action="validate")`
3. Common causes:
   - Broken flake input: retry `nix_config_proposal(action="update_flake_lock")`
   - Invalid module import or option: inspect the changed files under `flake.nix` and `core/os/`
   - Wrong repo path: confirm the local clone exists at `~/.workspace/pi-workspace`
4. Do not apply or publish until local validation passes and the diff is reviewed

## dufs WebDAV Issues

**Symptoms**: Files not accessible via WebDAV, connection refused on port 5000.

1. Check service state: `systemd_control service=nixpi-files action=status`
2. Check logs: `journalctl --user -u nixpi-files -n 100`
3. Verify port is listening: `curl -s http://localhost:5000/`
4. Common causes:
   - Service not running: restart with `systemd_control service=nixpi-files action=restart`
   - Port conflict: check for other services on port 5000
   - Quadlet/runtime issue: inspect the installed unit and generated logs

## Pi Startup Issues

**Symptoms**: Pi agent not responding or extensions failing to load.

1. Check Pi process: look for `pi` in running processes
2. Check logs: `journalctl -u pi-coding-agent --no-pager -n 50`
3. Common causes:
   - Extension compilation error: `npm run build` in the Workspace package
   - Missing dependency: `npm install` in the Workspace package
4. Recovery: restart the Pi agent service

## Disk Space Issues

**Symptoms**: Operations failing, "no space left on device" errors.

1. Check disk: `system_health`
2. Common consumers:
   - Nix store: `nix-collect-garbage -d`
   - Journal logs: `sudo journalctl --vacuum-size=500M`
   - Home directory: check for large files in `$HOME`
3. For `/var`: focus on logs and system state
4. For `/home`: focus on user content and downloaded media
