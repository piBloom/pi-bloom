# Bloom Service Packages

Bloom services are modular capabilities packaged as OCI artifacts and deployed via Podman Quadlet.

## Package Format

Each service package is a directory containing:

```
services/{name}/
├── quadlet/
│   ├── bloom-{name}.container    # Podman Quadlet container unit
│   ├── bloom-{name}.socket       # Optional socket activation unit
│   └── bloom-{name}-*.volume     # Optional volume definitions
└── SKILL.md                      # Pi skill file (frontmatter + docs)
```

## OCI Artifact Distribution

Service packages are pushed to GHCR as OCI artifacts using `oras`:

```
ghcr.io/pibloom/bloom-svc-{name}:<version>
```

> `bloom-svc-{name}` is the OCI *artifact* name (the installable package containing quadlet files and SKILL.md). This is distinct from the container *image* referenced inside the quadlet — which may be upstream (e.g., `docker.io/fedirz/faster-whisper-server`) or custom (e.g., `ghcr.io/<owner>/bloom-whatsapp`).
>
> Use immutable semver tags for installs (e.g., `0.1.0`). Treat `latest` as development-only.

### Pushing

```bash
just svc-push {name}
```

### Pulling & Installing

```bash
just svc-install {name}
```

Or manually:
```bash
mkdir -p /tmp/bloom-svc
oras pull ghcr.io/pibloom/bloom-svc-{name}:{version} -o /tmp/bloom-svc/
cp /tmp/bloom-svc/quadlet/* ~/.config/containers/systemd/
[ -f ~/.config/containers/systemd/bloom.network ] || cp /usr/local/share/bloom/os/sysconfig/bloom.network ~/.config/containers/systemd/bloom.network 2>/dev/null || cp os/sysconfig/bloom.network ~/.config/containers/systemd/bloom.network
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

## Worked Example Packages

Reference packages are included at:

| Path | Pattern | Notes |
|------|---------|-------|
| `services/examples/demo-api/` | Standard service (`PublishPort`) | Basic non-socket service package layout |
| `services/examples/demo-socket-echo/` | Socket-activated (`.socket` + `.container`) | Reference wiring for on-demand activation |
| `services/whisper/quadlet/` | Production socket-activated service | Real in-tree implementation |

Use these as templates for frontmatter, Quadlet layout, health checks, and local install commands.

Copy/paste quickstart commands are in `services/examples/README.md`.

## End-to-End Lifecycle Example

### Using Bloom tools

1. `service_scaffold(name="demo-api", description="Demo HTTP API", image="docker.io/library/nginx:stable", version="0.1.0", port=9080, container_port=80)`
2. `service_test(name="demo-api")`
3. `service_publish(name="demo-api", version="0.1.0")`
4. `service_install(name="demo-api", version="0.1.0")`
5. Verify: `systemctl --user status bloom-demo-api` and `manifest_show`

### Using shell commands

```bash
# scaffold manually under services/demo-api/
just svc-push demo-api
just svc-install demo-api
systemctl --user status bloom-demo-api
```

## OCI Annotations

Each artifact carries standard annotations:

| Annotation | Description |
|------------|-------------|
| `org.opencontainers.image.title` | `bloom-{name}` |
| `org.opencontainers.image.description` | Human-readable description |
| `org.opencontainers.image.source` | `https://github.com/pibloom/pi-bloom` |
| `org.opencontainers.image.version` | Semver version |
| `dev.bloom.service.category` | `media`, `communication`, `networking`, `sync`, or `utility` |
| `dev.bloom.service.port` | Exposed port (if any) |

## Quadlet Conventions

- Container name: `bloom-{name}`
- Network: prefer isolated Podman network (`bloom.network`); use host only when required (e.g., VPN)
- Health checks: required (`HealthCmd`, `HealthInterval`, `HealthRetries`)
- Logging: `LogDriver=journald`
- Security: `NoNewPrivileges=true` minimum
- Restart: `on-failure` with `RestartSec=10`

## Available Services

| Service | Category | Port | Description |
|---------|----------|------|-------------|
| `whisper` | media | 9000 | Speech-to-text transcription via faster-whisper |
| `whatsapp` | communication | — | WhatsApp messaging bridge via Baileys |
| `tailscale` | networking | — | Secure mesh VPN via Tailscale |
| `syncthing` | sync | 8384 | Peer-to-peer sync for the Garden vault |

## Service Catalog

`services/catalog.yaml` defines canonical service metadata for automation:

- default versions
- artifact references (`bloom-svc-*`)
- runtime image references
- service-specific preflight requirements

`manifest_apply` uses this catalog during auto-install and preflight checks.
