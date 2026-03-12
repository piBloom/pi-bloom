# Bloom Live Tester Memory

## VM Access
- SSH: `sshpass -p '<see bib-config.toml>' ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p 2222 pi@localhost`
- Password is in `os/bib-config.toml` (gitignored). Key-based auth not configured by default.
- Must use `sshpass` for non-interactive SSH; `ssh-askpass` is not available in CI/headless.
- Commands that return non-zero (e.g., systemctl status for missing units) will cancel parallel tool calls. Use `|| true` or chain commands in a single SSH session.

## Known Issues (as of 2026-03-12)
- See `vm-diagnostics.md` for detailed findings.
- **netbird crash-loop (FIXED)**: `/var/log/netbird/` missing after `rm -rf /var/*` → exit 209. Fix: tmpfiles.d entry + systemd drop-in for ordering. Committed 427e00b.
- **hostname "fedora" (FIXED)**: bootc strips `/etc/hostname` from image. Fix: `hostnamectl set-hostname bloom` in wizard welcome step. Committed 427e00b.
- **pi-daemon missing peerDep (FIXED)**: Symlink added in Containerfile: `ln -sf /usr/local/lib/node_modules/@mariozechner /usr/local/share/bloom/node_modules/@mariozechner`
- **dufs healthcheck broken**: Uses `wget` in HealthCmd but dufs image has no `wget`. Container runs fine but reports unhealthy permanently.
- **bloom.network unused**: Defined in Quadlet but no container references it. Never created by podman.
- **Gateway cinny-config**: Points to `http://fedora` instead of correct Matrix address.

## Boot Timing
- VM boots and SSH available within ~30 seconds.
- First-boot wizard starts ~1 min after boot.
- Quadlet services deployed ~7 min after boot (after webdav setup step).
- Auto-login on tty1/ttyS0 triggers `.bash_profile` which runs bloom-greeting then exec pi.

## Service Architecture (confirmed in VM)
- **System services**: bloom-matrix (continuwuity:6167), netbird, bloom-update-check.timer
- **User services**: bloom-gateway (:18810), bloom-dufs (:5000), pi-daemon
- Quadlet files at `~/.config/containers/systemd/` (deployed by setup wizard, not baked into image)
- pi-daemon has override.conf drop-in at `~/.config/systemd/user/pi-daemon.service.d/`

## Ports (confirmed in live VM)
- Matrix (continuwuity): 6167
- Cinny: 18810 (host) -> 80 (container)
- dufs: 5000 (host networking)
- NetBird: wt0 interface, 100.109.x.x/16
