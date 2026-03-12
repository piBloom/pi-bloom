# VM Diagnostic Findings — 2026-03-12

## Summary
Significant progress since 2026-03-10. First-boot wizard runs partially (6/11 steps completed). Quadlet files are now deployed. Cinny and dufs containers run. Matrix homeserver works. Pi-daemon eventually runs after manual intervention (override.conf pointing to bloom-runtime copy). Several issues remain.

## Critical Findings

### 1. pi-daemon crash-loops on first start (missing dependency)
- System-installed path `/usr/local/share/bloom/dist/daemon/index.js` fails
- Error: `Cannot find package '@mariozechner/pi-coding-agent' imported from /usr/local/share/bloom/dist/lib/shared.js`
- Package is a `peerDependency` in package.json, listed in `devDependencies` only
- It exists globally at `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/` but NODE_PATH is unset in the service
- Workaround applied: `override.conf` drop-in redirects to `~/.local/share/bloom-runtime/dist/daemon/index.js`
- Restart counter hit 7+ before override was applied

### 2. ConditionPathExists in wrong section
- `pi-daemon.service` has `ConditionPathExists=%h/.bloom/.setup-complete` in `[Service]` section
- systemd logs: "Unknown key 'ConditionPathExists' in section [Service], ignoring."
- Should be in `[Unit]` section
- As a result, daemon starts even before setup is complete

### 3. dufs healthcheck permanently failing
- dufs container is "unhealthy" (FailingStreak=15+) despite serving HTTP 200 from host
- HealthCmd uses `wget` but dufs image (`sigoden/dufs:v0.38.0`) is a minimal image with no `wget` binary
- Every 30s, conmon spawns a healthcheck that fails → `conmon <error>: Failed to create container: exit status 1`
- This floods the error journal continuously

### 4. First-boot setup incomplete
- 6/11 steps completed: welcome, network, netbird, connectivity, webdav, matrix
- 5 steps pending: git_identity, contributing, persona, test_message, complete
- `~/.bloom/.setup-complete` does NOT exist
- `completedAt` is null in setup-state.json

### 5. bloom.network not used by any container
- Quadlet defines `bloom.network` (bridge, 10.89.1.0/24)
- But dufs uses `Network=host` and gateway uses `pasta` (default)
- `podman network inspect bloom` returns "network not found" (never created by podman)
- The bloom.network Quadlet exists but no container references it

## Important Findings

### 6. Gateway cinny-config points to wrong homeserver
- Gateway's `cinny-config.json` has `"homeserverList": ["http://fedora"]`
- Should be `http://localhost:6167` or `http://bloom:6167` for local Matrix
- Users connecting via NetBird from another device would need `http://<netbird-ip>:6167`

### 7. No nginx service
- nginx.service does not exist on this image (previously reported as running)
- No `/etc/nginx/nginx.conf` present
- Port 80 returns connection refused
- This contradicts previous memory entry — nginx was likely removed from the image

### 8. bloom-matrix user unit not-found
- `systemctl --user list-units` shows `bloom-matrix.service not-found`
- Matrix runs as a SYSTEM service (`/usr/lib/systemd/system/bloom-matrix.service`), not user service
- This is fine architecturally but may confuse monitoring that expects all bloom-* as user units

## Minor Findings

### 9. Sway/display units removed
- bloom-sway.service and bloom-display.target no longer exist
- This fixes the crash-loop noise from previous diagnostic
- Clean improvement

### 10. Deprecation warning in pi-daemon
- `(node:3748) [DEP0060] DeprecationWarning: The util._extend API is deprecated`
- Comes from matrix-bot-sdk dependency
- Non-blocking but noisy

### 11. rpc/nfs errors at boot
- `rpc.statd` and `rpcbind` throw errors about missing state directories
- NFS not used by Bloom; these services could be masked

## What IS Working

- **SSH**: Available within ~30s of boot
- **bootc**: Image `localhost/bloom-os:latest` version 42.20260311.0
- **Matrix homeserver**: continuwuity 0.5.0-rc.6 on port 6167, both @pi:bloom and @user:bloom registered
- **Pi agent**: v0.57.1 installed at /usr/local/bin/pi
- **Cinny**: Healthy, serving on port 18810, healthcheck passing
- **dufs**: Actually serving HTTP 200 on port 5000 (just healthcheck is broken)
- **NetBird**: Connected, 2/4 peers, IP 100.109.145.101/16
- **Bloom directory**: Fully seeded — 4 persona files, 8 skills, guardrails.yaml, blueprint-versions.json
- **Pi state**: ~/.pi/ with agent settings, auth, matrix credentials, sessions
- **Quadlet deployment**: ~/.config/containers/systemd/ has bloom-gateway.container, bloom-dufs.container
- **Pi daemon** (after override): Connected to Matrix, creating sessions, routing messages
- **Audit log**: Active at ~/Bloom/audit/2026-03-11.jsonl
- **Internet**: Outbound connectivity working (HTTP 200 from fedoraproject.org)
- **OS updates**: Check ran, no updates available

## Boot Timing
- VM up and SSH available: ~30 seconds
- Setup wizard starts: ~22:58 (about 1 min after boot)
- Quadlet services deployed: ~23:04 (about 7 min after boot, after webdav step)
- Pi daemon stable: ~23:12 (after manual override, about 15 min after boot)

## Ports Confirmed
- Matrix (continuwuity): 6167 (system service)
- dufs: 5000 (host networking, user container)
- Cinny: 18810 (mapped from container port 80)
- NetBird: wt0 interface, 100.109.x.x/16
