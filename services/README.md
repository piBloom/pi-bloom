# Bloom Service Packages

Bloom services are modular capabilities deployed via Podman Quadlet, installed from bundled local packages.

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

## Installing a Service

Services are installed from bundled local packages. The `service_install` tool or `manifest_apply` handles:

1. Copy quadlet files to `~/.config/containers/systemd/`
2. Copy socket files to `~/.config/systemd/user/` (if present)
3. Copy SKILL.md to `~/Bloom/Skills/{name}/`
4. `systemctl --user daemon-reload`
5. Start the service unit

Manual install:

```bash
cp services/{name}/quadlet/*.container ~/.config/containers/systemd/
cp services/{name}/quadlet/*.socket ~/.config/systemd/user/ 2>/dev/null || true
mkdir -p ~/Bloom/Skills/{name}
cp services/{name}/SKILL.md ~/Bloom/Skills/{name}/SKILL.md
systemctl --user daemon-reload
systemctl --user start bloom-{name}.service
```

## Reference Package

| Path | Pattern | Notes |
|------|---------|-------|
| `services/dufs/quadlet/` | Production HTTP service (`PublishPort`) | Real in-tree implementation |

Use as a template for frontmatter, Quadlet layout, health checks, and local install commands.

## End-to-End Lifecycle Example

### Using Bloom tools

1. `service_scaffold(name="demo-api", description="Demo HTTP API", image="docker.io/library/nginx:stable", version="0.1.0", port=9080, container_port=80)`
2. `service_test(name="demo-api")`
3. `service_install(name="demo-api", version="0.1.0")`
4. Verify: `systemctl --user status bloom-demo-api` and `manifest_show`

## Quadlet Conventions

- Container name: `bloom-{name}`
- Network: host networking
- Health checks: required (`HealthCmd`, `HealthInterval`, `HealthRetries`)
- Logging: `LogDriver=journald`
- Security: `NoNewPrivileges=true` minimum
- Restart: `on-failure` with `RestartSec=10`

## Available Services

| Service | Category | Port | Description |
|---------|----------|------|-------------|
| `dufs` | sync | 5000 | WebDAV file server via dufs |
| `code-server` | development | 8443 | VS Code in the browser (optional) |

**Note:** Matrix (Continuwuity) and NetBird are OS-level infrastructure baked into the image, not container services.

## Service Catalog

`services/catalog.yaml` defines canonical service metadata for automation:

- default versions
- runtime image references
- service-specific preflight requirements

`manifest_apply` uses this catalog during auto-install and preflight checks.
