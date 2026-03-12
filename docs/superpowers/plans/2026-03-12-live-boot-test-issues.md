# Live Boot Test Issues — 2026-03-12

Tracking issues discovered during real `just build && just qcow2 && just vm` cycle.

---

## Issue 1: NetBird RPM post-install scriptlet failure during build

**Phase:** `just build` (container image build)
**Severity:** Low (likely harmless)
**Log:**
```
>>> Error: install service: exit status 1
>>> Error: start service: exit status 1
>>> [RPM] %post(netbird-0.66.4-1.x86_64) scriptlet failed, exit status 1
```

**Analysis:** Expected and harmless. The RPM `%post` scriptlet tries to `systemctl start netbird` during container build where systemd isn't running. The package installs correctly — files are in place. Mitigations already exist in `00-base-post.sh`: empty state files are cleaned up (prevents JSON parse crash on boot), and `systemctl preset` enables the service for real boot.
**Fix:** None needed.

---

## Issue 2: npm deprecated dependencies and vulnerabilities

**Phase:** `just build` (npm install)
**Severity:** Medium
**Log:**
```
npm warn deprecated request-promise@4.2.6, request@2.88.2, har-validator@5.1.5
npm warn deprecated uuid@3.4.0, glob@10.5.0, node-domexception@1.0.0
8 vulnerabilities (6 moderate, 2 critical)
```

**Analysis:** Single root cause: `matrix-bot-sdk@0.8.0` (direct dep in `package.json`) depends on deprecated `request@2.88.2` / `request-promise@4.2.6`, which pull in vulnerable `form-data@2.3.3` (critical SSRF), `qs` (DoS), `tough-cookie` (prototype pollution), `uuid@3`, `har-validator`. One additional moderate vuln comes from `file-type@21.3.0` via `@mariozechner/pi-coding-agent`. The `glob@10.5.0` deprecation is transitive via `google-auth-library`.
**Fix options:**
1. Replace `matrix-bot-sdk` with a maintained Matrix client library (e.g. `matrix-js-sdk` or direct HTTP calls to Continuwuity)
2. Run `npm audit fix` to resolve the `file-type` moderate vuln
3. The `glob`/`node-domexception` deprecations are transitive from pi-coding-agent — not actionable here

---

## Issue 3: bootc container lint warning — nonempty /run

**Phase:** `just build` (final lint step)
**Severity:** Low
**Log:**
```
Lint warning: nonempty-run-tmp: Found content in runtime-only directories:
  /run/dnf
  /run/systemd
  /run/systemd/resolve
```

**Analysis:** Expected and harmless. `/run` is a tmpfs mount in the booted system — any content baked into the image is discarded when systemd initializes `/run` on boot. The files are left by dnf and systemd operations during the build. Cleaning `/run` mid-build could cause systemd protocol errors. The lint check passes (warnings are informational, not failures).
**Fix:** None needed.

---

## Issue 4: NetBird daemon not running at wizard time — socket missing

**Phase:** `just vm` (first boot, setup wizard — NetBird step)
**Severity:** HIGH
**Log:**
```
dial unix /var/run/netbird.sock: connect: no such file or directory
Error: failed to connect to daemon error: context deadline exceeded
```

**Analysis:** Two-part failure:
1. **Root cause:** The Containerfile does `rm -rf /var/*` which deletes `/var/log/netbird/`. The netbird service file specifies `--log-file /var/log/netbird/client.log`, so systemd fails to set up stdout → exit code 209 (`STDOUT`) → crash loop.
2. **Compounding issue:** The wizard calls `sudo netbird up` without checking if the daemon socket exists, then loops forever on failure with no escape.

**Fix (applied):**
1. Added `d /var/log/netbird 0755 root root -` and `d /var/lib/netbird 0755 root root -` to `os/system_files/usr/lib/tmpfiles.d/bloom.conf` so the directories are recreated on boot.
2. Added daemon readiness check in `step_netbird()`: starts the service if not active, waits up to 10s for the socket, fails gracefully with a diagnostic message.

**Files changed:**
- `os/system_files/usr/lib/tmpfiles.d/bloom.conf`
- `os/system_files/usr/local/bin/bloom-wizard.sh`

---

## Issue 5: Hostname "fedora" instead of "bloom"

**Phase:** `just vm` (first boot)
**Severity:** Medium
**Log:**
```
Static hostname: (unset)
Transient hostname: fedora
/etc/hostname: No such file or directory
```

**Analysis:** The image includes `os/system_files/etc/hostname` with content "bloom", which gets copied during build. However, bootc manages `/etc/hostname` itself — during installation, BIB removes the image's `/etc/hostname` and should apply `hostname = "bloom"` from `bib-config.toml`. But BIB's qcow2 output doesn't seem to honor the `[customizations] hostname` setting, so the system falls back to the kernel default "fedora". The `/etc/hostname` file from the image is stripped by bootc's `/etc` merge semantics.
**Fix:** Set hostname at first boot via tmpfiles.d or a systemd oneshot service. Or use `hostnamectl set-hostname bloom` in the wizard's early steps.

---

## Issue 6: NetBird service StandardOutput/StandardError pointing to missing dir

**Phase:** `just vm` (boot)
**Severity:** HIGH (same root cause as Issue 4)
**Log:**
```
netbird.service: Failed to set up standard output: No such file or directory
netbird.service: Failed at step STDOUT spawning /usr/bin/netbird: No such file or directory
```

**Analysis:** The RPM-provided netbird.service unit has `StandardOutput=file:/var/log/netbird/netbird.out` and `StandardError=file:/var/log/netbird/netbird.err`. After `rm -rf /var/*` in the Containerfile, this directory doesn't exist on boot. Systemd fails to open the output files before even execing the binary → exit 209. The tmpfiles.d fix from Issue 4 (`d /var/log/netbird 0755 root root -`) resolves this. However, tmpfiles.d runs early but possibly AFTER netbird.service starts. A systemd drop-in override may also be needed to add `After=systemd-tmpfiles-setup.service`.
**Fix (partially applied):** tmpfiles.d entry added in Issue 4. May need a drop-in to ensure ordering:
```ini
# os/system_files/etc/systemd/system/netbird.service.d/10-bloom.conf
[Unit]
After=systemd-tmpfiles-setup.service
```

---

## Issue 7: Matrix federation endpoint not responding

**Phase:** `just vm` (runtime check)
**Severity:** Low (may be expected)
**Log:**
```
curl -sf http://localhost:6167/_matrix/federation/v1/version → empty
```

**Analysis:** Expected. `matrix.toml` has `allow_federation = false` and `address = "127.0.0.1"`. The federation endpoint is intentionally disabled. Not a bug.
**Fix:** None needed.

---

## Issue 8: Matrix registration fails — empty auth object rejected by Continuwuity

**Phase:** `just vm` (first boot, setup wizard — Matrix step)
**Severity:** HIGH
**Log:**
```
ERROR: Failed to get session ID from Matrix server
ERROR: Failed to register @pi:bloom bot account.
```

**Analysis:** The `matrix_register()` function sends `"auth":{}` (empty auth object) in the first POST to `/_matrix/client/v3/register`, expecting a 401 with a session ID. However, Continuwuity (conduwuit 0.5.0-rc.6) rejects this with `M_BAD_JSON: deserialization failed: missing field 'session'` — it tries to deserialize the auth object and fails because it has no `session` field. The fix is to omit the `auth` field entirely from the first request, which correctly returns the UIA flows and a session ID.
**Fix (applied):** Removed `"auth":{}` from the step 1 curl payload in `matrix_register()`. The request now sends only `username`, `password`, and `inhibit_login`.
**Files changed:**
- `os/system_files/usr/local/bin/bloom-wizard.sh`

---

## Issue 9: Pi starts even when setup wizard fails

**Phase:** `just vm` (first boot)
**Severity:** Medium
**Log:**
```
ERROR: Failed to register @pi:bloom bot account.
{"ts":"2026-03-12T20:04:42.077Z","level":"info","component":"bloom-services","msg":"service lifecycle extension loaded"}
 pi v0.57.1
```

**Analysis:** When the wizard exits with an error (e.g., Matrix registration failure), `.bash_profile` continues execution and starts Pi anyway, even though `.setup-complete` was never created. The Pi startup block doesn't check for `.setup-complete`. On next login the wizard would re-run (since the file is missing), but the user gets a confusing Pi session in the meantime.
**Fix (applied):** Added `[ -f "$HOME/.bloom/.setup-complete" ]` guard to the Pi startup block in `.bash_profile`.
**Files changed:**
- `os/system_files/etc/skel/.bash_profile`

---

*More issues will be appended as the boot test progresses.*
