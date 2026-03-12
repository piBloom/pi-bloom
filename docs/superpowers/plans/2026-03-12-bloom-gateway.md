# Bloom Gateway Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace standalone Cinny container with a Caddy-based unified reverse proxy (bloom-gateway) that serves Cinny, Matrix API, and WebDAV on a single port — with dynamic route registration so new services auto-register.

**Architecture:** Caddy container with host networking and baked-in Cinny static files. A volume-mounted Caddyfile is generated from `~/.config/bloom/gateway-routes.json`. Routes `/_matrix/*` to Continuwuity (localhost:6167), `/webdav/*` to dufs (localhost:5000), and serves Cinny as the default. Single port 18810 from any IP. When services are installed, they register a route and the Caddyfile is regenerated + gateway restarted.

**Tech Stack:** Caddy 2 (alpine), Cinny v4.3.0 (static files), Podman Quadlet, bash

**Spec:** `docs/superpowers/specs/2026-03-12-bloom-gateway-design.md`

---

## Chunk 1: Create Gateway Service Package

### Task 1: Create gateway Containerfile

**Files:**
- Create: `services/gateway/Containerfile`

- [ ] **Step 1: Create the Containerfile**

The Caddyfile is NOT baked in — it's volume-mounted at runtime so routes can be dynamically registered. Only Cinny static files and cinny-config.json are baked in.

```dockerfile
FROM ghcr.io/cinnyapp/cinny:v4.3.0 AS cinny
FROM docker.io/library/caddy:2-alpine
COPY --from=cinny /usr/share/nginx/html /srv/cinny
COPY cinny-config.json /srv/cinny/config.json
```

- [ ] **Step 2: Commit**

```bash
git add services/gateway/Containerfile
git commit -m "feat(gateway): add Containerfile — Caddy + Cinny multi-stage build"
```

### Task 2: Create default Caddyfile template

**Files:**
- Create: `services/gateway/Caddyfile`

- [ ] **Step 1: Create the default Caddyfile**

This is the seed Caddyfile shipped with the service package, used as the initial state before route registration. It includes the static routes (well-known, Cinny SPA) that are always present. The `generate_caddyfile` function (Task 6) produces files in this same format.

```
:18810 {
	# Well-known for Matrix client discovery (same-origin base URL)
	handle /.well-known/matrix/client {
		header Content-Type application/json
		respond `{"m.homeserver": {"base_url": "/"}}` 200
	}

	# Default: Cinny web client (SPA with fallback)
	handle {
		root * /srv/cinny
		file_server
		try_files {path} /index.html
	}
}
```

Note: no proxy routes here — those are added dynamically via `gateway-routes.json`. The default Caddyfile is only used if no routes have been registered yet (first install before any services are added).

- [ ] **Step 2: Commit**

```bash
git add services/gateway/Caddyfile
git commit -m "feat(gateway): add default Caddyfile — static well-known + Cinny SPA"
```

### Task 3: Create Cinny config for gateway

**Files:**
- Create: `services/gateway/cinny-config.json`

- [ ] **Step 1: Create cinny-config.json**

The empty string means "same origin" — Cinny will resolve `/_matrix/*` relative to whatever address the user opened. If `""` doesn't work at runtime, fall back to `"/"`.

```json
{
	"defaultHomeserver": 0,
	"homeserverList": [""],
	"allowCustomHomeservers": false
}
```

- [ ] **Step 2: Commit**

```bash
git add services/gateway/cinny-config.json
git commit -m "feat(gateway): add Cinny config — same-origin homeserver"
```

### Task 4: Create gateway quadlet unit

**Files:**
- Create: `services/gateway/quadlet/bloom-gateway.container`

- [ ] **Step 1: Create the quadlet file**

Key changes from old `bloom-cinny.container`:
- Image: `localhost/bloom-gateway:latest` (locally built)
- `Network=host` — required so gateway can reach localhost-bound backends
- **Volume-mounted Caddyfile** at `~/.config/bloom/Caddyfile` — generated dynamically from route registry
- Memory: 128m (Caddy needs more than static nginx)
- Health check on port 18810 (host network)

```ini
[Unit]
Description=Bloom Gateway — unified web proxy (Cinny + Matrix + WebDAV)
After=network-online.target
Wants=network-online.target

[Container]
Image=localhost/bloom-gateway:latest
ContainerName=bloom-gateway

# Host networking — gateway must reach localhost-bound backends
Network=host

# Dynamic Caddyfile — regenerated when services are added/removed
Volume=%h/.config/bloom/Caddyfile:/etc/caddy/Caddyfile:ro,Z

PodmanArgs=--memory=128m
PodmanArgs=--security-opt label=disable
HealthCmd=wget -qO- http://localhost:18810/ || exit 1
HealthInterval=30s
HealthRetries=3
HealthTimeout=10s
HealthStartPeriod=30s
NoNewPrivileges=true
LogDriver=journald

[Service]
Restart=on-failure
RestartSec=10
TimeoutStartSec=120
TimeoutStopSec=30

[Install]
WantedBy=default.target
```

- [ ] **Step 2: Commit**

```bash
git add services/gateway/quadlet/bloom-gateway.container
git commit -m "feat(gateway): add quadlet unit — host networking, volume-mounted Caddyfile"
```

### Task 5: Create gateway SKILL.md

**Files:**
- Create: `services/gateway/SKILL.md`

- [ ] **Step 1: Create SKILL.md**

```markdown
---
name: gateway
version: 0.1.0
description: Bloom Gateway — unified web proxy for Cinny, Matrix API, and WebDAV
image: localhost/bloom-gateway:latest
---

# Bloom Gateway

Unified reverse proxy serving all Bloom web services on a single port.

## Overview

The gateway runs Caddy with baked-in Cinny static files and a dynamic Caddyfile. It routes registered services by path prefix:

- `/_matrix/*` → Continuwuity Matrix homeserver (localhost:6167)
- `/webdav/*` → dufs file server (localhost:5000)
- `/*` → Cinny web client (default)

All services are accessible from a single address: `http://<host>:18810`.

## Dynamic Route Registration

When services are installed, they register a route in `~/.config/bloom/gateway-routes.json`. The Caddyfile is regenerated and the gateway restarted. New services only need a `gateway_path` and `port` to be accessible.

## Setup

Installed via the first-boot wizard or service tools:

- `service_install(name="gateway")`

The gateway image must be built locally before first use (the wizard handles this).

## Usage

1. Open `http://<host>:18810` in a browser
2. Log in with your Matrix credentials (username and password from setup)
3. Session persists in browser — no need to log in again

WebDAV: `http://<host>:18810/webdav/`

## Troubleshooting

- Logs: `journalctl --user -u bloom-gateway -n 50`
- Status: `systemctl --user status bloom-gateway`
- Restart: `systemctl --user restart bloom-gateway`
- Route registry: `cat ~/.config/bloom/gateway-routes.json`
- Generated Caddyfile: `cat ~/.config/bloom/Caddyfile`
- Rebuild image: `podman build -t localhost/bloom-gateway:latest -f Containerfile .` (from services/gateway/)
```

- [ ] **Step 2: Commit**

```bash
git add services/gateway/SKILL.md
git commit -m "feat(gateway): add SKILL.md"
```

---

## Chunk 2: Gateway Route Registry and Caddyfile Generation

### Task 6: Create gateway route generation library

**Files:**
- Create: `lib/gateway.ts`
- Create: `tests/lib/gateway.test.ts`

This is the core of the dynamic routing system. A small library that:
1. Reads/writes `~/.config/bloom/gateway-routes.json`
2. Generates a Caddyfile from the routes
3. Restarts the gateway container

- [ ] **Step 1: Write tests for gateway route registry**

```typescript
import { describe, it, expect } from "vitest";
import { generateCaddyfile, type GatewayRoutes } from "../../lib/gateway.js";

describe("generateCaddyfile", () => {
	it("generates Caddyfile with no proxy routes", () => {
		const routes: GatewayRoutes = { routes: {} };
		const result = generateCaddyfile(routes);
		expect(result).toContain(":18810 {");
		expect(result).toContain("/.well-known/matrix/client");
		expect(result).toContain("/srv/cinny");
		expect(result).not.toContain("reverse_proxy");
	});

	it("generates handle block for non-stripping route", () => {
		const routes: GatewayRoutes = {
			routes: {
				"/_matrix": { port: 6167, strip_prefix: false },
			},
		};
		const result = generateCaddyfile(routes);
		expect(result).toContain("handle /_matrix/*");
		expect(result).toContain("reverse_proxy localhost:6167");
		expect(result).not.toContain("handle_path /_matrix/*");
	});

	it("generates handle_path block for stripping route", () => {
		const routes: GatewayRoutes = {
			routes: {
				"/webdav": { port: 5000, strip_prefix: true },
			},
		};
		const result = generateCaddyfile(routes);
		expect(result).toContain("handle_path /webdav/*");
		expect(result).toContain("reverse_proxy localhost:5000");
	});

	it("generates multiple routes", () => {
		const routes: GatewayRoutes = {
			routes: {
				"/_matrix": { port: 6167, strip_prefix: false },
				"/webdav": { port: 5000, strip_prefix: true },
				"/code": { port: 8443, strip_prefix: true },
			},
		};
		const result = generateCaddyfile(routes);
		expect(result).toContain("handle /_matrix/*");
		expect(result).toContain("handle_path /webdav/*");
		expect(result).toContain("handle_path /code/*");
		expect(result).toContain("localhost:8443");
	});

	it("always includes well-known and Cinny fallback", () => {
		const routes: GatewayRoutes = {
			routes: {
				"/_matrix": { port: 6167, strip_prefix: false },
			},
		};
		const result = generateCaddyfile(routes);
		expect(result).toContain("/.well-known/matrix/client");
		expect(result).toContain("try_files {path} /index.html");
	});
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
npm run test -- tests/lib/gateway.test.ts
```
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement gateway.ts**

```typescript
/** Gateway route registry and Caddyfile generation. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { run } from "./exec.js";

export interface GatewayRoute {
	port: number;
	strip_prefix: boolean;
}

export interface GatewayRoutes {
	routes: Record<string, GatewayRoute>;
}

const GATEWAY_ROUTES_FILENAME = "gateway-routes.json";
const CADDYFILE_FILENAME = "Caddyfile";

function configDir(): string {
	return join(os.homedir(), ".config", "bloom");
}

/** Read the gateway route registry. Returns empty routes if file doesn't exist. */
export function readGatewayRoutes(): GatewayRoutes {
	const routesPath = join(configDir(), GATEWAY_ROUTES_FILENAME);
	if (!existsSync(routesPath)) {
		return { routes: {} };
	}
	try {
		return JSON.parse(readFileSync(routesPath, "utf-8"));
	} catch {
		return { routes: {} };
	}
}

/** Write the gateway route registry. */
export function writeGatewayRoutes(routes: GatewayRoutes): void {
	const routesPath = join(configDir(), GATEWAY_ROUTES_FILENAME);
	writeFileSync(routesPath, `${JSON.stringify(routes, null, "\t")}\n`);
}

/** Add a route to the registry. */
export function addGatewayRoute(path: string, port: number, stripPrefix: boolean): void {
	const routes = readGatewayRoutes();
	routes.routes[path] = { port, strip_prefix: stripPrefix };
	writeGatewayRoutes(routes);
}

/** Remove a route from the registry. */
export function removeGatewayRoute(path: string): void {
	const routes = readGatewayRoutes();
	delete routes.routes[path];
	writeGatewayRoutes(routes);
}

/** Generate a Caddyfile from the route registry. */
export function generateCaddyfile(routes: GatewayRoutes): string {
	const lines: string[] = [":18810 {"];

	// Proxy routes (registered services)
	for (const [path, route] of Object.entries(routes.routes)) {
		const directive = route.strip_prefix ? "handle_path" : "handle";
		lines.push(`\t${directive} ${path}/* {`);
		lines.push(`\t\treverse_proxy localhost:${route.port}`);
		lines.push("\t}");
		lines.push("");
	}

	// Well-known for Matrix client discovery (always present)
	lines.push("\thandle /.well-known/matrix/client {");
	lines.push("\t\theader Content-Type application/json");
	lines.push('\t\trespond `{"m.homeserver": {"base_url": "/"}}` 200');
	lines.push("\t}");
	lines.push("");

	// Default: Cinny web client (always present)
	lines.push("\thandle {");
	lines.push("\t\troot * /srv/cinny");
	lines.push("\t\tfile_server");
	lines.push("\t\ttry_files {path} /index.html");
	lines.push("\t}");
	lines.push("}");
	lines.push("");

	return lines.join("\n");
}

/** Write the generated Caddyfile to ~/.config/bloom/Caddyfile. */
export function writeCaddyfile(routes: GatewayRoutes): void {
	const caddyfilePath = join(configDir(), CADDYFILE_FILENAME);
	writeFileSync(caddyfilePath, generateCaddyfile(routes));
}

/** Regenerate the Caddyfile from the route registry and restart the gateway. */
export async function refreshGateway(signal?: AbortSignal): Promise<void> {
	const routes = readGatewayRoutes();
	writeCaddyfile(routes);
	await run("systemctl", ["--user", "restart", "bloom-gateway.service"], signal);
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npm run test -- tests/lib/gateway.test.ts
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/gateway.ts tests/lib/gateway.test.ts
git commit -m "feat(gateway): add route registry and Caddyfile generation library"
```

### Task 7: Create bash gateway helpers for the wizard

**Files:**
- Create: `os/system_files/usr/local/bin/bloom-gateway-lib.sh`

The wizard needs bash equivalents of `addGatewayRoute`, `generateCaddyfile`, and `writeCaddyfile`. These are sourced by the wizard script.

- [ ] **Step 1: Create the bash library**

```bash
#!/usr/bin/env bash
# bloom-gateway-lib.sh — Gateway route registry and Caddyfile generation (bash).
# Sourced by bloom-wizard.sh and available for manual use.

GATEWAY_ROUTES="${BLOOM_CONFIG:-$HOME/.config/bloom}/gateway-routes.json"
GATEWAY_CADDYFILE="${BLOOM_CONFIG:-$HOME/.config/bloom}/Caddyfile"

# Add a route to the gateway registry.
# Usage: gateway_add_route <path> <port> <strip_prefix: true|false>
gateway_add_route() {
	local path="$1" port="$2" strip="$3"
	local routes="{}"
	[[ -f "$GATEWAY_ROUTES" ]] && routes=$(cat "$GATEWAY_ROUTES")

	# Use python3 (available in Fedora) for reliable JSON manipulation
	routes=$(python3 -c "
import json, sys
r = json.loads(sys.argv[1])
if 'routes' not in r: r['routes'] = {}
r['routes'][sys.argv[2]] = {'port': int(sys.argv[3]), 'strip_prefix': sys.argv[4] == 'true'}
print(json.dumps(r, indent='\t'))
" "$routes" "$path" "$port" "$strip")

	echo "$routes" > "$GATEWAY_ROUTES"
}

# Generate and write the Caddyfile from the route registry.
gateway_regenerate() {
	local routes="{\"routes\":{}}"
	[[ -f "$GATEWAY_ROUTES" ]] && routes=$(cat "$GATEWAY_ROUTES")

	python3 -c "
import json, sys

r = json.loads(sys.argv[1])
routes = r.get('routes', {})

lines = [':18810 {']
for path, route in routes.items():
    directive = 'handle_path' if route.get('strip_prefix', False) else 'handle'
    lines.append(f'\t{directive} {path}/* {{')
    lines.append(f'\t\treverse_proxy localhost:{route[\"port\"]}')
    lines.append('\t}')
    lines.append('')

lines.append('\thandle /.well-known/matrix/client {')
lines.append('\t\theader Content-Type application/json')
lines.append('\t\trespond \x60{\"m.homeserver\": {\"base_url\": \"/\"}}\x60 200')
lines.append('\t}')
lines.append('')
lines.append('\thandle {')
lines.append('\t\troot * /srv/cinny')
lines.append('\t\tfile_server')
lines.append('\t\ttry_files {path} /index.html')
lines.append('\t}')
lines.append('}')
lines.append('')
print('\n'.join(lines))
" "$routes" > "$GATEWAY_CADDYFILE"
}

# Restart the gateway service (if running).
gateway_restart() {
	systemctl --user restart bloom-gateway.service 2>/dev/null || true
}
```

- [ ] **Step 2: Commit**

```bash
git add os/system_files/usr/local/bin/bloom-gateway-lib.sh
git commit -m "feat(gateway): add bash route registry and Caddyfile generation"
```

---

## Chunk 3: Integrate Route Registration into Service Install

### Task 8: Update service-io.ts — register gateway routes on install

**Files:**
- Modify: `extensions/bloom-services/service-io.ts`

- [ ] **Step 1: Remove templateCinnyConfig and add gateway route registration**

Two changes to `service-io.ts`:

1. Remove the `templateCinnyConfig` function (lines 18-29) and its special-case in the config copy loop (lines 89-92). Simplify to just copy config files:

In the config copy loop, change:
```typescript
		let content = readFileSync(src, "utf-8");
		if (fileName === "cinny-config.json") {
			content = templateCinnyConfig(content);
		}
		writeFileSync(dest, content);
```
to:
```typescript
		writeFileSync(dest, readFileSync(src));
```

2. After enabling the service (at the end of `installServicePackage`), check if the service has a `gateway_path` in catalog and register the route. Import from `lib/gateway.ts`:

Add import at top:
```typescript
import { addGatewayRoute, refreshGateway } from "../../lib/gateway.js";
```

Add after the service is enabled (before the `return { ok: true, ... }`), accept catalog info as a parameter or read it. The simplest approach: add optional `gatewayPath` and `gatewayStripPrefix` parameters:

Actually, keep it simpler — add a `gateway` field to catalog.yaml entries and read it from the catalog in the install handler (`actions-install.ts`), then call `addGatewayRoute` + `refreshGateway` there. This keeps `service-io.ts` focused on file copying and `actions-install.ts` on orchestration.

So in `service-io.ts`, just remove `templateCinnyConfig` and simplify the config copy.

- [ ] **Step 2: Commit**

```bash
git add extensions/bloom-services/service-io.ts
git commit -m "refactor(services): remove Cinny config templating — gateway bakes its own config"
```

### Task 9: Add gateway_path to catalog.yaml

**Files:**
- Modify: `services/catalog.yaml`

- [ ] **Step 1: Update catalog entries**

Replace `cinny` with `gateway`, and add `gateway_path` + `gateway_strip_prefix` fields to services that should be proxied:

```yaml
version: 1
source_repo: https://github.com/pibloom/pi-bloom
services:
  dufs:
    version: "0.1.0"
    category: sync
    image: docker.io/sigoden/dufs:v0.38.0
    optional: false
    port: 5000
    gateway_path: /webdav
    gateway_strip_prefix: true
    preflight:
      commands: [podman, systemctl]
  gateway:
    version: "0.1.0"
    category: communication
    image: localhost/bloom-gateway:latest
    optional: false
    port: 18810
    preflight:
      commands: [podman, systemctl]
  code-server:
    version: "0.1.0"
    category: development
    image: localhost/bloom-code-server:latest
    optional: true
    port: 8443
    gateway_path: /code
    gateway_strip_prefix: true
    preflight:
      commands: [podman, systemctl]
```

Note: Matrix (`/_matrix`) is always registered by the wizard (it's a system service, not a catalog service). The gateway itself has no `gateway_path` — it IS the gateway.

- [ ] **Step 2: Commit**

```bash
git add services/catalog.yaml
git commit -m "feat(gateway): add gateway_path to catalog — services declare their route"
```

### Task 10: Update actions-install.ts — register routes after service install

**Files:**
- Modify: `extensions/bloom-services/actions-install.ts`

- [ ] **Step 1: Add gateway route registration to handleInstall**

Read the current file first. After a service is successfully installed, check if it has a `gateway_path` in the catalog and register the route:

Add import:
```typescript
import { addGatewayRoute, refreshGateway } from "../../lib/gateway.js";
```

After successful service install (where `installResult.ok` is true), add:
```typescript
// Register gateway route if service declares one
const catalogEntry = /* read from catalog */;
if (catalogEntry?.gateway_path) {
	addGatewayRoute(
		catalogEntry.gateway_path,
		catalogEntry.port,
		catalogEntry.gateway_strip_prefix ?? false,
	);
	await refreshGateway(signal);
}
```

The exact location depends on how `handleInstall` is structured — read the file and find where the success path is.

- [ ] **Step 2: Commit**

```bash
git add extensions/bloom-services/actions-install.ts
git commit -m "feat(gateway): auto-register routes when services are installed"
```

---

## Chunk 4: Lock Down Backend Services

### Task 11: Bind dufs to localhost only

**Files:**
- Modify: `services/dufs/quadlet/bloom-dufs.container`

- [ ] **Step 1: Change dufs to bind to localhost only**

Keep `Network=host` (simplest — avoids container networking issues with volume mounts) but change dufs to listen on `127.0.0.1` only. The gateway (also on host network) reaches it at `localhost:5000`.

Change the comment:
```ini
# Host networking — localhost only, accessed via bloom-gateway reverse proxy
Network=host
```

Change:
```ini
Exec=/data -A -p 5000
```
to:
```ini
# Localhost only — proxied via bloom-gateway on :18810/webdav/
Exec=/data -A -b 127.0.0.1 -p 5000
```

- [ ] **Step 2: Commit**

```bash
git add services/dufs/quadlet/bloom-dufs.container
git commit -m "fix(dufs): bind to localhost only — proxied via gateway"
```

### Task 12: Bind Continuwuity to localhost only

**Files:**
- Modify: `os/system_files/etc/bloom/matrix.toml`

- [ ] **Step 1: Change Continuwuity address binding**

Change:
```toml
address = "0.0.0.0"
```
to:
```toml
address = "127.0.0.1"
```

- [ ] **Step 2: Commit**

```bash
git add os/system_files/etc/bloom/matrix.toml
git commit -m "fix(matrix): bind Continuwuity to localhost only — proxied via gateway"
```

### Task 13: Delete services/cinny/ directory

**Files:**
- Delete: `services/cinny/` (entire directory)

- [ ] **Step 1: Remove the directory**

```bash
git rm -r services/cinny/
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(gateway): remove standalone cinny service — replaced by gateway"
```

---

## Chunk 5: Update Wizard

### Task 14: Update wizard to install gateway and register routes

**Files:**
- Modify: `os/system_files/usr/local/bin/bloom-wizard.sh`

- [ ] **Step 1: Source the gateway library and add build_local_image helper**

Near the top of the wizard (after the variable declarations, around line 16), add:

```bash
# shellcheck source=/dev/null
source /usr/local/bin/bloom-gateway-lib.sh
```

After `install_service` (around line 141), add:

```bash
# Build a localhost/* container image from a service's Containerfile
# Usage: build_local_image <name>  →  builds localhost/bloom-<name>:latest
build_local_image() {
	local name="$1"
	local svc_dir="${BLOOM_SERVICES}/${name}"
	if [[ ! -f "$svc_dir/Containerfile" ]]; then
		echo "  Containerfile not found: ${svc_dir}/Containerfile" >&2
		return 1
	fi
	podman build -t "localhost/bloom-${name}:latest" -f "$svc_dir/Containerfile" "$svc_dir"
}
```

- [ ] **Step 2: Update step_services to install gateway with route registration**

Replace the Cinny block (around line 366) with:

```bash
	read -rp "Install Bloom Gateway? (web access to Matrix chat + file server) [y/N]: " gateway_answer
	if [[ "${gateway_answer,,}" == "y" ]]; then
		echo "  Building gateway image (this may take a minute)..."
		if build_local_image gateway; then
			# Register Matrix route (always present when gateway is installed)
			gateway_add_route "/_matrix" 6167 false
			gateway_regenerate
			if install_service gateway; then
				echo "  Gateway installed."
				installed="${installed} gateway"
			else
				echo "  Gateway installation failed."
			fi
		else
			echo "  Gateway image build failed."
		fi
	fi
```

Also update the dufs install block to register its gateway route when both dufs AND gateway are installed. Change the dufs block to:

```bash
	read -rp "Install dufs file server? (access files from any device via WebDAV) [y/N]: " dufs_answer
	if [[ "${dufs_answer,,}" == "y" ]]; then
		echo "  Installing dufs..."
		if install_service dufs; then
			echo "  dufs installed."
			installed="${installed} dufs"
			# Route will be registered when gateway is installed (if user chooses it)
		else
			echo "  dufs installation failed."
		fi
	fi
```

After the gateway install block, if gateway was installed AND dufs was installed, register the dufs route:

```bash
	# Register dufs route if both gateway and dufs were installed
	if [[ "$installed" == *gateway* ]] && [[ "$installed" == *dufs* ]]; then
		gateway_add_route "/webdav" 5000 true
		gateway_regenerate
		gateway_restart
	fi
```

- [ ] **Step 3: Commit**

```bash
git add os/system_files/usr/local/bin/bloom-wizard.sh
git commit -m "feat(wizard): install gateway with dynamic route registration"
```

---

## Chunk 6: Update References and Verify

### Task 15: Update step-guidance.ts (if needed)

**Files:**
- Check: `extensions/bloom-setup/step-guidance.ts`

- [ ] **Step 1: Verify no cinny references exist**

Run: `grep -i cinny extensions/bloom-setup/step-guidance.ts`
Expected: no matches. The current file only has `persona` and `complete` guidance — no changes needed.

### Task 16: Search for remaining cinny references

**Files:**
- Various — search and update as needed

- [ ] **Step 1: Search for stale references**

```bash
grep -ri "cinny\|bloom-cinny\|18810.*cinny" --include='*.ts' --include='*.md' --include='*.yaml' --include='*.sh' --include='*.toml' -l .
```

For each file found: update references from "cinny" to "gateway" where appropriate. References to "Cinny" as the Matrix web client name (not the service name) can stay — Cinny is still the client, it's just served through the gateway.

- [ ] **Step 2: Commit any updates**

```bash
git add -A
git commit -m "docs: update cinny references to gateway"
```

### Task 17: Verify build and lint

- [ ] **Step 1: Run TypeScript build**

```bash
npm run build
```
Expected: no errors.

- [ ] **Step 2: Run Biome lint/format check**

```bash
npm run check
```
Expected: clean. If format issues, run `npm run check:fix`.

- [ ] **Step 3: Run tests**

```bash
npm run test
```
Expected: all pass. If any tests reference cinny config templating, update them.

- [ ] **Step 4: Commit any fixes**

If any fixes were needed:
```bash
git add -A
git commit -m "fix: resolve build/lint/test issues from gateway migration"
```

### Task 18: Test gateway container build locally

- [ ] **Step 1: Build the gateway image**

```bash
cd services/gateway && podman build -t localhost/bloom-gateway:latest -f Containerfile . && cd -
```
Expected: successful build.

- [ ] **Step 2: Smoke test the container**

First, create a test Caddyfile (since it's now volume-mounted):
```bash
mkdir -p /tmp/gateway-test
cat > /tmp/gateway-test/Caddyfile << 'EOF'
:18810 {
	handle /.well-known/matrix/client {
		header Content-Type application/json
		respond `{"m.homeserver": {"base_url": "/"}}` 200
	}
	handle {
		root * /srv/cinny
		file_server
		try_files {path} /index.html
	}
}
EOF

podman run --rm -d --name bloom-gateway-test --network=host \
  -v /tmp/gateway-test/Caddyfile:/etc/caddy/Caddyfile:ro \
  localhost/bloom-gateway:latest
sleep 2
# Check Cinny serves
curl -sf http://localhost:18810/ | head -5
# Check well-known responds
curl -sf http://localhost:18810/.well-known/matrix/client
# Cleanup
podman stop bloom-gateway-test
rm -rf /tmp/gateway-test
```
Expected: Cinny HTML on `/`, JSON `{"m.homeserver": {"base_url": "/"}}` on `/.well-known/matrix/client`.

- [ ] **Step 3: Test Caddyfile generation**

```bash
npm run test -- tests/lib/gateway.test.ts
```
Expected: all PASS.

No commit needed — this is local verification.
