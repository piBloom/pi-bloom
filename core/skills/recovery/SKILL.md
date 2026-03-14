---
name: recovery
description: Troubleshooting and recovery procedures for common Bloom system issues
---

# Recovery Playbooks

Use these procedures when diagnosing and recovering from common system issues. Always start with `system_health` for an overview before diving into specific playbooks.

Use `audit_review` to inspect recent tool actions when you need to reconstruct what changed before an incident.

## Matrix Homeserver Issues

**Symptoms**: Messages not delivered, Pi not responding in Matrix rooms.

1. Check system health: `system_health`
2. Check Matrix service: `systemctl status bloom-matrix`
3. Check logs: `journalctl -u bloom-matrix -n 100`
4. Common causes:
   - Server not running: `sudo systemctl restart bloom-matrix`
   - Database corruption: check `/var/lib/continuwuity/` for issues
   - Port conflict: verify nothing else is on port 6167
5. If Pi is not responding to messages:
   - Check Pi agent is running and pi-daemon.service is active (`systemctl --user status pi-daemon`)
   - Verify Pi's Matrix credentials at `~/.pi/matrix-credentials.json`

## Bridge Issues

**Symptoms**: External messages (WhatsApp, Telegram, Signal) not arriving.

1. Check bridge container: `container(action="status")` — look for `bloom-<bridge>`
2. Check bridge logs: `container(action="logs", service="bloom-<bridge>", lines=100)`
3. Common causes:
   - Bridge container not running: `systemd_control service=bloom-<bridge> action=restart`
   - Appservice not registered: check `/etc/bloom/appservices/` for registration YAML
   - Bridge login expired: re-authenticate via the bridge's web interface
4. Use `bridge_status` to see all bridge states

## OS Update Failure

**Symptoms**: Update staged but reboot fails, or system boots into old image.

1. Check current image: `bootc(action="status")`
2. If booted into wrong image: `bootc(action="rollback")` to revert
3. If update stuck: check `bootc(action="check")` for available updates
4. Common causes:
   - Network interruption during download: retry `bootc(action="download")`
   - Incompatible image: rollback and report to maintainer
   - Disk full: check with `system_health`, clear space in /var
5. After rollback: schedule reboot with `schedule_reboot delay_minutes=1`

## dufs WebDAV Issues

**Symptoms**: Files not accessible via WebDAV, connection refused on port 5000.

1. Check service state: `systemd_control service=bloom-dufs action=status`
2. Check logs: `container(action="logs", service="bloom-dufs", lines=100)`
3. Verify port is listening: `curl -s http://localhost:5000/`
4. Common causes:
   - Container not running: restart: `systemd_control service=bloom-dufs action=restart`
   - Port conflict: check for other services on port 5000
   - Bind mount issue: verify home directory is accessible inside container
5. Prevention: check `system_health` regularly for service status

## Pi Startup Issues

**Symptoms**: Pi agent not responding or extensions failing to load.

1. Check Pi process: look for `pi` in running processes
2. Check logs: `journalctl -u pi-coding-agent --no-pager -n 50`
3. Common causes:
   - Extension compilation error: `npm run build` in Bloom package
   - Missing dependency: `npm install` in Bloom package
4. Recovery: restart the Pi agent service

## Container Health Issues

**Symptoms**: Container reported unhealthy or restarting repeatedly.

1. Check status: `container(action="status")`
2. Check health: look for "unhealthy" or "restarting" states
3. Inspect logs: `container(action="logs", service="<name>", lines=200)`
4. Common causes:
   - Health check endpoint not responding: check application inside container
   - Resource limits hit: check memory/CPU with `system_health`
   - Network issue: verify container has host network access
5. Recovery: `systemd_control service=<name> action=restart`
6. If persistent: `systemd_control service=<name> action=stop`, investigate, then start

## Disk Space Issues

**Symptoms**: Operations failing, "no space left on device" errors.

1. Check disk: `system_health` — look at Disk Usage section
2. Common consumers:
   - Container images: `podman image prune` to remove unused
   - Journal logs: `sudo journalctl --vacuum-size=500M`
   - Home directory: check for large files in `$HOME`
3. For /var partition: focus on container images and logs
4. For /home partition: focus on user content and downloaded media
