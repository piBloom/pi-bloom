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

## Bridge Management

External messaging bridges (WhatsApp, Telegram, Signal) connect to the native Matrix homeserver:

- `bridge_create` — pull bridge image, generate Quadlet and config, register appservice
- `bridge_remove` — stop and remove a bridge
- `bridge_status` — list running bridge containers

Bridge metadata is in `services/catalog.yaml` under `bridges:`.

## Mesh Access

When a service has a `port` defined in `services/catalog.yaml`, `service_install` automatically creates:
- A NetBird DNS A record for `{name}.bloom.mesh` (if `NETBIRD_API_TOKEN` is set in `~/.config/bloom/netbird.env`)

After installation, services are accessible at `http://{name}.bloom.mesh:{port}` from any mesh peer. Services bind directly to the host network — no reverse proxy is needed.

If no NetBird token is configured, DNS is skipped. Services remain accessible via the device's mesh IP and port directly.

## End-to-End Example (Scaffold -> Test -> Install)

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

Reference package:
- `services/dufs/quadlet/` (production HTTP service reference)

## Install a Service

Services install from bundled local packages in `services/{name}/`:

```bash
mkdir -p ~/.config/containers/systemd ~/.config/systemd/user
find services/{name}/quadlet -maxdepth 1 -type f -name '*.socket' -exec cp {} ~/.config/systemd/user/ \;
find services/{name}/quadlet -maxdepth 1 -type f ! -name '*.socket' -exec cp {} ~/.config/containers/systemd/ \;
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

## Service Dependencies

| Service | Depends On | Handling |
|---------|-----------|----------|
| `dufs` | Local home bind mount | `%h` bind mount |
| `netbird` | Network stack (NET_ADMIN, /dev/net/tun) | Host network mode |

## OS-Level Infrastructure (Not Managed as Services)

These are baked into the OS image and run as native systemd services:

| Service | Unit | Purpose |
|---------|------|---------|
| Matrix (Continuwuity) | `bloom-matrix.service` | Communication backbone |
| NetBird | `netbird.service` | Mesh networking |

## Known Container Services

| Name | Version | Category | Description |
|------|---------|----------|-------------|
| `dufs` | 0.1.0 | sync | WebDAV file server via dufs (port 5000) |
