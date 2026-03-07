---
name: service-management
description: Install, manage, and discover bundled service packages
---

# Service Management

Bloom services are modular capabilities bundled as local packages. Each package contains Quadlet container units and a SKILL.md file.

Follow `docs/supply-chain.md` for reproducibility and verification policy.

Service metadata defaults (version, preflight requirements) are tracked in `services/catalog.yaml`.

## Lifecycle Tools

Bloom exposes service lifecycle tools:

- `service_scaffold` — create a new service package skeleton
- `service_install` — install service from bundled local package
- `service_test` — run a local smoke test on installed units

Related declarative tools:

- `manifest_show` — display the current service manifest
- `manifest_sync` — reconcile manifest with running state
- `manifest_set_service` — declare desired service state in `~/Bloom/manifest.yaml`
- `manifest_apply` — apply desired state (install missing, start enabled, stop disabled)

## End-to-End Example (Scaffold → Test → Install)

Use this sequence when creating a new service package:

1. Scaffold package files:
   - `service_scaffold(name="demo-api", description="Demo HTTP API", image="docker.io/library/nginx:stable", version="0.1.0", port=9080, container_port=80)`
2. Smoke test locally:
   - `service_test(name="demo-api", start_timeout_sec=120)`
3. Install from local package:
   - `service_install(name="demo-api")`
4. Verify result:
   - `systemctl --user status bloom-demo-api`
   - `manifest_show`

For socket-activated services, scaffold with `socket_activated=true` and a `port`, then verify both units:
- `systemctl --user status bloom-{name}.socket`
- `systemctl --user status bloom-{name}`

Reference packages:
- `services/examples/demo-api/`
- `services/examples/demo-socket-echo/`
- `services/examples/README.md` (copy/paste quickstart commands)
- `services/lemonade/quadlet/` (production HTTP service reference)

## Install a Service

Services install from bundled local packages in `services/{name}/`:

```bash
mkdir -p ~/.config/containers/systemd ~/.config/systemd/user
find services/{name}/quadlet -maxdepth 1 -type f -name '*.socket' -exec cp {} ~/.config/systemd/user/ \;
find services/{name}/quadlet -maxdepth 1 -type f ! -name '*.socket' -exec cp {} ~/.config/containers/systemd/ \;
[ -f ~/.config/containers/systemd/bloom.network ] || cp /usr/local/share/bloom/os/sysconfig/bloom.network ~/.config/containers/systemd/bloom.network
mkdir -p ~/Bloom/Skills/{name}
cp services/{name}/SKILL.md ~/Bloom/Skills/{name}/SKILL.md
systemctl --user daemon-reload
if [ -f ~/.config/systemd/user/bloom-{name}.socket ]; then
  systemctl --user start bloom-{name}.socket
else
  systemctl --user start bloom-{name}.service
fi
```

Use `service_install(name="{name}")` to automate this process.

## Remove a Service

```bash
systemctl --user stop bloom-{name}.socket 2>/dev/null || true
systemctl --user stop bloom-{name}.service 2>/dev/null || true
rm -f ~/.config/containers/systemd/bloom-{name}.*
rm -f ~/.config/systemd/user/bloom-{name}.socket
rm -rf ~/Bloom/Skills/{name}
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

## Service Dependencies

Services may depend on other components:

| Service | Depends On | Handling |
|---------|-----------|----------|
| `whatsapp` | Pi channels server (`$XDG_RUNTIME_DIR/bloom/channels.sock`) | Unix socket reconnect with exponential backoff |
| `lemonade` | None (standalone HTTP API) | — |
| `netbird` | Network stack (NET_ADMIN, /dev/net/tun) | Host network mode |
| `dufs` | Local home bind mount | `%h` bind mount |

Pi's channels server is a user-space interactive process, not a systemd service. Service bridges handle unavailability via reconnect logic.

## Versioning

Service SKILL.md files include `version` and `image` fields in their frontmatter:

```yaml
---
name: lemonade
version: 0.1.0
image: ghcr.io/lemonade-sdk/lemonade-server:latest
---
```

### Check Installed Version

The manifest at `~/Bloom/manifest.yaml` tracks installed service versions. Use `manifest_show` to view current state.

### Pin a Service Version

Update the manifest with `manifest_set_service` to record the desired version.

## Known Services

| Name | Version | Category | Description |
|------|---------|----------|-------------|
| `lemonade` | 0.1.0 | ai | Local LLM + STT via Lemonade (port 8000) |
| `whatsapp` | 0.2.0 | communication | WhatsApp messaging bridge via Baileys |
| `netbird` | 0.1.0 | networking | Secure mesh VPN via NetBird |
| `dufs` | 0.1.0 | sync | WebDAV file server via dufs (port 5000) |
