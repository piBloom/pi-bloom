# Bloom OS Fixer Memory

## Fix Patterns

### Missing /var directory → service crash
- **Symptom**: Service exits with code 209/STDOUT, journal shows "Failed to set up standard output: No such file or directory"
- **Cause**: Containerfile does `rm -rf /var/*` but service needs a /var subdirectory
- **Fix**: Add `d /var/<path> 0755 <user> <group> -` to `os/system_files/usr/lib/tmpfiles.d/bloom.conf` AND add systemd drop-in `After=systemd-tmpfiles-setup.service` if the service starts before tmpfiles runs
- **Example**: netbird.service needed `/var/log/netbird/` for StandardOutput and --log-file

### bootc strips /etc/hostname
- **Symptom**: Hostname shows "fedora" instead of "bloom" despite /etc/hostname being in the image
- **Cause**: bootc manages /etc/hostname itself during install, ignoring the image's copy
- **Fix**: Set hostname at runtime via `hostnamectl set-hostname bloom` in wizard or a oneshot service

## Issues Tracker
- Current tracker: `docs/superpowers/plans/2026-03-12-live-boot-test-issues.md`

## Related Agent Memory
- bloom-live-tester diagnostics: `.claude/agent-memory/bloom-live-tester/vm-diagnostics.md`
- bloom-live-tester memory: `.claude/agent-memory/bloom-live-tester/MEMORY.md`
