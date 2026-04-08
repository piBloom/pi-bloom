---
name: recovery
description: Troubleshooting and recovery procedures for common NixPI system issues
---

# Recovery Playbooks

Use these procedures when diagnosing and recovering from common system issues. Always start with `system_health` for an overview before diving into specific playbooks.

## Pi Runtime Access Issues

**Symptoms**: The SSH or local terminal access is unavailable, or Pi is not responding in the shell-first runtime.

1. Check system health: `system_health`
2. Check the Pi runtime setup unit: `systemctl status nixpi-app-setup.service`
3. Common causes:
   - Runtime setup incomplete: inspect `~/.pi/` and verify the primary operator account can read/write it
   - Shell access unavailable: verify SSH and local login for the primary operator account
4. If Pi itself is not responding:
   - Verify `pi` runs directly from SSH or a local shell
   - Confirm `~/.pi/` exists and is writable for the primary operator account

## OS Update Failure

**Symptoms**: Update failed, or system boots into old NixOS generation.

1. Check current generation: `nixos_update(action="status")`
2. If booted into wrong generation: `nixos_update(action="rollback")` to revert
3. If update failed: check the last update status file
4. Common causes:
   - Network interruption during build: retry `sudo nixpi-rebuild-pull`
   - Evaluation error: check `/etc/nixos/flake.nix`; if you use an operator checkout such as `/srv/nixpi`, confirm it still matches the intended repo state
   - Disk full: check with `system_health`, run `nix-collect-garbage`
5. Steady-state workflows:
   - rebuild the installed host configuration with `sudo nixpi-rebuild`
   - if you maintain the conventional `/srv/nixpi` operator checkout, sync it with `sudo nixpi-rebuild-pull [branch]`
6. After rollback: confirm with `nixos_update(action="status")`

## Local Nix Proposal Failure

**Symptoms**: Local repo changes fail validation before review or switch.

1. Check local proposal state: `nix_config_proposal(action="status")`
2. Run validation: `nix_config_proposal(action="validate")`
3. Common causes:
   - Broken flake input: retry `nix_config_proposal(action="update_flake_lock")`
   - Invalid module import or option: inspect the changed files under `flake.nix` and `core/os/`
   - Wrong repo path: confirm the intended local clone exists; the conventional on-host checkout is `/srv/nixpi`, but it is optional
4. Do not apply or publish until local validation passes and the diff is reviewed

## Disk Space Issues

**Symptoms**: Operations failing, "no space left on device" errors.

1. Check disk: `system_health`
2. Common consumers:
   - Nix store: `nix-collect-garbage -d`
   - Journal logs: `sudo journalctl --vacuum-size=500M`
   - Home directory: check for large files in `$HOME`
3. For `/var`: focus on logs and system state
4. For `/home`: focus on user content and downloaded media
