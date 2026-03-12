# Bloom Gateway Design

## Problem

Cinny (Matrix web client) requires users to specify a homeserver URL and log in. When accessing remotely via NetBird, the hardcoded `localhost:6167` homeserver doesn't work — the browser runs on a different machine, so `localhost` points to the wrong host. Users must manually change the URL to the NetBird IP. This is a single-user OS; this friction is unnecessary.

Additionally, each service (Cinny, dufs, future services) exposes its own port, requiring users to remember multiple port numbers.

## Solution

Replace the standalone `bloom-cinny` container with a `bloom-gateway` container: Caddy reverse-proxying all Bloom web services behind path prefixes on a single port (18810), with Cinny static files served as the default.

## Architecture

```
Browser (any IP)
    |
    v :18810
+------------------+
|      Caddy       |
|  /_matrix/*  ----+--> host:6167  (Continuwuity)
|  /webdav/*   ----+--> host:5000  (dufs)
|  /*          ----+--> /srv/cinny (static files)
+------------------+
```

- Cinny config sets `homeserverList: [""]` — uses same origin, so `/_matrix/*` is resolved relative to whatever address the user opened
- Works from `localhost:18810`, `100.x.x.x:18810`, or any future address
- Single port, single address for all services
- Future services added by appending `handle_path` blocks to the Caddyfile

## Container Build

Multi-stage Containerfile at `services/gateway/Containerfile`:

1. **Stage 1**: Pull Cinny static files from `ghcr.io/cinnyapp/cinny:v4.3.0`
2. **Stage 2**: Caddy alpine base, copy in Cinny files + Caddyfile + cinny-config.json

```dockerfile
FROM ghcr.io/cinnyapp/cinny:v4.3.0 AS cinny
FROM docker.io/library/caddy:2-alpine
COPY --from=cinny /usr/share/nginx/html /srv/cinny
COPY Caddyfile /etc/caddy/Caddyfile
COPY cinny-config.json /srv/cinny/config.json
```

## Caddyfile

```
:80 {
    # Matrix API — use `handle` (not `handle_path`) to preserve /_matrix prefix
    handle /_matrix/* {
        reverse_proxy host.containers.internal:6167
    }

    # Well-known for Matrix client discovery
    handle /.well-known/matrix/* {
        respond /client `{"m.homeserver": {"base_url": "/"}}` 200 {
            header Content-Type application/json
        }
    }

    # WebDAV — `handle_path` strips /webdav prefix (dufs expects root paths)
    handle_path /webdav/* {
        reverse_proxy host.containers.internal:5000
    }

    # Default: Cinny web client
    handle {
        root * /srv/cinny
        file_server
        try_files {path} /index.html
    }
}
```

## Cinny Configuration

```json
{
    "defaultHomeserver": 0,
    "homeserverList": [""],
    "allowCustomHomeservers": false
}
```

- Empty string homeserver = same origin (needs verification against Cinny v4.3.0 — if `""` doesn't work, use `"/"` or a relative URL)
- `.well-known/matrix/client` endpoint returns `{"m.homeserver": {"base_url": "/"}}` as fallback discovery
- Custom homeservers disabled (single-user OS, local server only)

## Quadlet Unit

`services/gateway/quadlet/bloom-gateway.container` replaces `bloom-cinny.container`:
- Same port: 18810 mapped to container port 80
- Bridged networking with `PublishPort=18810:80` (same as current bloom-cinny)
- `host.containers.internal` resolves to host (Podman 4.1+, shipped with Fedora 42)
- Health check: `curl -sf http://localhost:80/ || exit 1`
- Memory limit: 128m (increased from 64m — Caddy uses more than static nginx due to reverse proxy buffers)

## Files to Create

| File | Purpose |
|------|---------|
| `services/gateway/Containerfile` | Multi-stage build (Cinny static + Caddy) |
| `services/gateway/Caddyfile` | Routing rules |
| `services/gateway/cinny-config.json` | Homeserver set to `""` |
| `services/gateway/quadlet/bloom-gateway.container` | Quadlet unit |

## Files to Modify

| File | Change |
|------|--------|
| `services/catalog.yaml` | Replace `cinny` entry with `gateway` |
| `extensions/bloom-setup/step-guidance.ts` | Update matrix step — reference gateway, remove homeserver URL instructions |
| `extensions/bloom-services/service-io.ts` | Update config templating (homeserver URL becomes `""`) |
| `services/dufs/quadlet/bloom-dufs.container` | Bind to `127.0.0.1:5000` only (no longer exposed directly) |
| `os/system_files/etc/bloom/matrix.toml` | Bind Continuwuity to `127.0.0.1` only |

## Files to Remove

| File | Reason |
|------|--------|
| `services/cinny/` (entire directory) | Replaced by gateway |

## Deployment Changes

| Component | Before | After |
|-----------|--------|-------|
| Cinny | `bloom-cinny` — stock image, port 18810 | `bloom-gateway` — custom Caddy+Cinny, port 18810 |
| dufs | Own exposed port on wt0 | localhost only, proxied via gateway `/webdav/*` |
| Continuwuity | `0.0.0.0:6167` | `127.0.0.1:6167` (only gateway needs it) |
| Firewall | Multiple service ports on wt0 | Only 18810 + SSH |

## First-Boot Impact

Setup step changes from:
1. Install Cinny → Install gateway
2. "Open `http://<ip>:18810`, set homeserver to `<ip>:6167`" → "Open `http://<ip>:18810`"
3. User logs in once with username/password — session persists in browser localStorage

## Login Persistence

Cinny stores sessions in browser localStorage/IndexedDB. After first login, subsequent visits are automatic. No auto-login mechanism needed for v1.

## Future Extensibility

New services are added by:
1. Adding a `handle_path` block to the Caddyfile
2. Rebuilding the gateway container
3. Updating the catalog

Examples: `/vscode/*` for code-server, `/obsidian/*` for hosted Obsidian.

## Notes

- **No TLS**: HTTP-only for v1. NetBird mesh is already encrypted. Caddy's `:80` binding disables automatic HTTPS.
- **WebSocket**: Matrix sync uses long-polling/WebSocket. Caddy proxies WebSocket transparently by default.
- **CORS**: Not needed — Cinny and Matrix API are same-origin.
- **Caddyfile is baked into the image**: Routing changes require a rebuild. Volume-mounting the Caddyfile for runtime changes is a future option.
