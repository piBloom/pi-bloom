---
name: service-management
description: Install, manage, and discover OCI-packaged service containers
---

# Service Management

Bloom services are modular capabilities packaged as OCI artifacts. Each package contains Quadlet container units and a SKILL.md file.

Follow `docs/supply-chain.md` for reproducibility and verification policy.

## Registry

Service packages are hosted at:
```
ghcr.io/pibloom/bloom-svc-{name}:<version>
```

Use immutable semver tags (for example `0.1.0`) for installs. `latest` is mutable and should be explicit only for development.

Service metadata defaults (version, artifact ref, preflight requirements) are tracked in `services/catalog.yaml`.

## Lifecycle Tools

Bloom exposes service lifecycle tools:

- `service_scaffold` — create a new service package skeleton
- `service_publish` — publish service package to OCI registry
- `service_install` — install service package from OCI artifact
- `service_test` — run a local smoke test on installed units

Related declarative tools:

- `manifest_set_service` — declare desired service state in `~/Garden/Bloom/manifest.yaml`
- `manifest_apply` — apply desired state (install missing, start enabled, stop disabled)

## End-to-End Example (Scaffold → Test → Publish → Install)

Use this sequence when creating a new service package:

1. Scaffold package files:
   - `service_scaffold(name="demo-api", description="Demo HTTP API", image="docker.io/library/nginx:stable", version="0.1.0", port=9080, container_port=80)`
2. Smoke test locally:
   - `service_test(name="demo-api", start_timeout_sec=120)`
3. Publish immutable version:
   - `service_publish(name="demo-api", version="0.1.0")`
4. Install that exact version:
   - `service_install(name="demo-api", version="0.1.0")`
5. Verify result:
   - `systemctl --user status bloom-demo-api`
   - `manifest_show`

For socket-activated services, scaffold with `socket_activated=true` and a `port`, then verify both units:
- `systemctl --user status bloom-{name}.socket`
- `systemctl --user status bloom-{name}`

Reference packages:
- `services/examples/demo-api/`
- `services/examples/demo-socket-echo/`
- `services/examples/README.md` (copy/paste quickstart commands)
- `services/whisper/quadlet/` (production socket-activation reference)

## Install a Service

```bash
mkdir -p /tmp/bloom-svc
oras pull ghcr.io/pibloom/bloom-svc-{name}:{version} -o /tmp/bloom-svc/
cp /tmp/bloom-svc/quadlet/* ~/.config/containers/systemd/
[ -f ~/.config/containers/systemd/bloom.network ] || cp /usr/local/share/bloom/os/sysconfig/bloom.network ~/.config/containers/systemd/bloom.network
mkdir -p ~/Garden/Bloom/Skills/{name}
cp /tmp/bloom-svc/SKILL.md ~/Garden/Bloom/Skills/{name}/SKILL.md
systemctl --user daemon-reload
if [ -f ~/.config/containers/systemd/bloom-{name}.socket ]; then
  systemctl --user enable --now bloom-{name}.socket
else
  systemctl --user enable --now bloom-{name}
fi
rm -rf /tmp/bloom-svc
```

Notes:

- `service_install` is registry-first. If OCI pull fails but the service package exists in the local Bloom bundle, it may install from the bundled copy as a fallback.
- For `tailscale`, ensure rootless Podman subuid/subgid mappings exist for user `bloom` (`/etc/subuid`, `/etc/subgid`).

## Remove a Service

```bash
systemctl --user disable --now bloom-{name}.socket 2>/dev/null || true
systemctl --user disable --now bloom-{name} 2>/dev/null || true
rm ~/.config/containers/systemd/bloom-{name}.*
rm -rf ~/Garden/Bloom/Skills/{name}
systemctl --user daemon-reload
```

## List Installed Services

```bash
ls ~/.config/containers/systemd/bloom-*.container
```

## Check Service Health

```bash
systemctl --user status bloom-{name}
systemctl --user status bloom-{name}.socket  # if socket-activated
```

## View Service Logs

```bash
journalctl --user -u bloom-{name} -n 50
```

## Browse Available Versions

```bash
oras repo tags ghcr.io/pibloom/bloom-svc-{name}
```

## Backup and Restore (oras v1.3.0+)

Backup a service package locally before making changes:

```bash
oras backup ghcr.io/pibloom/bloom-svc-{name}:latest -o ~/Garden/Bloom/backups/
```

Restore a previously backed-up service:

```bash
oras restore ~/Garden/Bloom/backups/bloom-svc-{name}/ --to ghcr.io/pibloom/bloom-svc-{name}:rollback
```

## Service Dependencies

Services may depend on other components:

| Service | Depends On | Handling |
|---------|-----------|----------|
| `whatsapp` | Pi channels server (`/run/bloom/channels.sock`) | Unix socket reconnect with exponential backoff |
| `whisper` | None (standalone HTTP API) | — |
| `tailscale` | Network stack (NET_ADMIN, /dev/net/tun) | Host network mode |
| `syncthing` | Syncthing peers and local Garden bind mount | Host network mode + `%h/Garden` bind mount |

Pi's channels server is a user-space interactive process, not a systemd service. Service bridges handle unavailability via reconnect logic.

## Versioning

Service SKILL.md files include `version` and `image` fields in their frontmatter:

```yaml
---
name: whisper
version: 0.1.0
image: docker.io/fedirz/faster-whisper-server@sha256:760e5e43d427dc6cfbbc4731934b908b7de9c7e6d5309c6a1f0c8c923a5b6030
---
```

OCI artifacts use semver tags: `ghcr.io/pibloom/bloom-svc-whisper:0.1.0`

### Check Installed Version

The manifest at `~/Garden/Bloom/manifest.yaml` tracks installed service versions. Use `manifest_show` to view current state.

### Pin a Service Version

```bash
oras pull ghcr.io/pibloom/bloom-svc-{name}:0.1.0 -o /tmp/bloom-svc/
```

Then update the manifest with `manifest_set_service` to record the pinned version.

### Verify Artifact Digest (Recommended)

For higher assurance, resolve and pin the OCI artifact digest before install:

```bash
oras resolve ghcr.io/pibloom/bloom-svc-{name}:{version}
# => sha256:...
```

Then pass it to `service_install`:

- `service_install(name="{name}", version="{version}", expected_digest="sha256:...")`

`service_install` verifies the digest (when provided) and enforces pinned runtime images by default.

## Known Services

| Name | Version | Category | Description |
|------|---------|----------|-------------|
| `whisper` | 0.1.0 | media | Speech-to-text transcription (faster-whisper, port 9000) |
| `whatsapp` | 0.1.0 | communication | WhatsApp messaging bridge via Baileys |
| `tailscale` | 0.1.0 | networking | Secure mesh VPN via Tailscale |
| `syncthing` | 0.1.0 | sync | Peer-to-peer Garden vault sync via Syncthing (port 8384 UI) |
