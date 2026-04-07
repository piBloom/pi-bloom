# NixPI Runtime Flows

> End-to-end flows through the current local-only NixPI system

## Why Document Runtime Flows

Understanding how control and data move through NixPI helps with:
- Debugging issues that span NixOS services, the web chat surface, and Pi sessions
- Tracing where setup markers, session state, and memory files are written
- Changing one layer without breaking the local runtime contract

## Install/Build Flow

### Entry Points

| Entry Point | Command | Purpose |
|-------------|---------|---------|
| Local build | `nix build .#app` | Build the packaged app and bundled assets |
| System switch | `sudo nixos-rebuild switch --flake /etc/nixos#nixos` | Apply the standard system flake in `/etc/nixos`, which imports NixPI from `/srv/nixpi` |
| Canonical rebuild | `sudo nixpi-rebuild` | Run the same rebuild through the operator wrapper |

### Flow Steps

1. **System flake evaluation** (`/etc/nixos/flake.nix`)
   - Keeps the machine's standard `/etc/nixos/configuration.nix` entrypoint
   - Layers `nixpi.nixosModules.nixpi` from `/srv/nixpi` into the single `#nixos` configuration
   - Produces the machine closure without replacing host-specific hardware settings

2. **App build** (`npm run build`)
   - Compiles TypeScript into `dist/`
   - Builds the local chat frontend with Vite
   - Reads `package.json` for Pi extension and skill registration

3. **Service wiring**
   - `core/os/modules/app.nix` installs the packaged app and Pi agent
   - `nixpi-chat.service` is registered as the local runtime
   - `nginx` is configured as the HTTP/HTTPS entry point

### Key Files

| File | Role |
|------|------|
| `/etc/nixos/flake.nix` | Standard rebuild root used for applied systems |
| `flake.nix` | NixPI development flake for packages, checks, and CI |
| `core/os/modules/app.nix` | App package install and chat service wiring |
| `core/os/modules/app.nix` | `nixpi-chat.service` definition and runtime wiring |
| `package.json` | Build scripts, extensions, runtime dependencies |

## Boot/Service Startup Flow

### System Boot Sequence

```
systemd boot
    ↓
multi-user.target
    ↓
├─ wireguard-wg0.service
├─ nixpi-app-setup.service
├─ nixpi-chat.service
├─ nixpi-update.service
└─ nginx.service
```

### Local Chat Startup Flow

1. **State preparation** (`core/os/modules/app.nix`)
   - Creates `/var/lib/nixpi`
   - Seeds `~/.pi/settings.json` from the packaged defaults when missing
   - Ensures the runtime directories are owned by the primary user

2. **HTTP server bootstrap** (`core/chat-server/index.ts`)
   - Reads `NIXPI_CHAT_PORT` and `PI_DIR`
   - Starts the local HTTP server on `127.0.0.1`
   - Serves the built frontend from `core/chat-server/frontend/dist`

3. **Pi session bridge initialization** (`core/chat-server/pi-session.ts`)
   - Creates a single in-memory `pi-coding-agent` session bridge
   - Pre-warms the session on server startup
   - Resets the in-process session when the legacy reset route is called

4. **Web entry point** (`core/os/modules/service-surface.nix`)
   - `nginx` proxies inbound HTTP/HTTPS traffic to the local chat server
   - HTTP on port `80` redirects to HTTPS when the secure gateway is enabled

### Key Files

| File | Role |
|------|------|
| `core/chat-server/index.ts` | HTTP entry point for local chat |
| `core/chat-server/pi-session.ts` | Pi SDK event translation and reset lifecycle |
| `core/os/modules/app.nix` | Systemd unit definition and env wiring |
| `core/os/modules/service-surface.nix` | Reverse proxy and TLS setup |

## First-Boot/Setup Flow

### Phase 1: Setup Wizard

**Entry**: XFCE autologin launches the setup terminal

```
LightDM autologin
    ↓
XFCE session
    ↓
NixPI terminal
    ↓
setup-wizard.sh
    ↓
├─ Password change
├─ WiFi / internet setup
├─ Clone canonical repo checkout
├─ Write host config
├─ nixos-rebuild switch
├─ WireGuard peer setup
├─ Seed local Pi settings
└─ Mark system ready
```

### Phase 2: Persona Completion

**Entry**: First local Pi chat after the system-ready marker exists

```
Pi session start
    ↓
check wizard-state markers
    ↓
persona-done present?
    ↓
No: inject persona-completion guidance
Yes: continue with normal conversation
```

### State Files

| File | Purpose |
|------|---------|
| `~/.nixpi/wizard-state/system-ready` | First-boot completion sentinel used by services and tests |
| `~/.nixpi/wizard-state/persona-done` | Persona onboarding completion marker |
| `~/.pi/settings.json` | Local Pi runtime defaults and user-selected settings |

### Key Files

| File | Role |
|------|------|
| `core/scripts/nixpi-setup-apply.sh` | Minimal first-boot completion marker write |
| `core/pi/extensions/persona/` | Persona-completion prompt injection |
| `core/scripts/` | Wizard and install helpers |

## Local Chat Request Flow

### Incoming Message Flow

```
Browser UI
    ↓
POST /chat
    ↓
createChatServer()
    ↓
PiSessionBridge.sendMessage()
    ↓
pi-coding-agent session prompt()
    ↓
stream NDJSON events back to browser
```

### Session Rules

| Condition | Action |
|-----------|--------|
| Server startup | Pre-warm a single in-process Pi session |
| `POST /chat` | Reuse the current in-process Pi session |
| `DELETE /chat/:id` | Reset the current Pi session immediately (legacy compatibility route) |

### Key Files

| File | Role |
|------|------|
| `core/chat-server/index.ts` | `/chat` and static asset routing |
| `core/chat-server/pi-session.ts` | Pi session bridge and event translation |
| `tests/chat-server/server.test.ts` | HTTP contract coverage |
| `tests/chat-server/pi-session.test.ts` | Pi session bridge behavior |

## Memory/Object Flow

### Episode Creation Flow

```
Pi decides to record
    ↓
episode_create tool
    ↓
Write to ~/nixpi/Episodes/YYYY-MM-DD/<slug>.md
    ↓
Update episode index
```

### Object Promotion Flow

```
Episode(s) exist
    ↓
episode_promote tool
    ↓
Create ~/nixpi/Objects/<slug>.md
    ↓
Copy required frontmatter
    ↓
Link source episodes
```

### Consolidation Flow

```
Related objects exist
    ↓
episode_consolidate tool
    ↓
Merge into new object
    ↓
Mark sources superseded
```

### Key Files

| File | Role |
|------|------|
| `core/pi/extensions/episodes/` | Episode tools |
| `core/pi/extensions/objects/` | Object and promotion tools |
| `core/lib/frontmatter.ts` | Frontmatter parsing |

## Update/Proposal Flow

### Local Proposal Flow

```
Pi proposes change
    ↓
Edit files in the canonical working checkout
    ↓
Run validation (npm run test, etc.)
    ↓
Present diff for human review
    ↓
Human decides: commit, revise, or discard
```

### System Update Flow

```
nixpi-update timer (every 6 hours)
    ↓
Check for updates
    ↓
New version available?
    ↓
Download and prepare
    ↓
Apply on next window or manual trigger
```

### Key Files

| File | Role |
|------|------|
| `core/pi/extensions/nixpi/` | NixOS operations |
| `core/os/modules/update.nix` | Update service |
| `core/os/modules/update.nix` | Update service and timer wiring |

## Session Reset / Cleanup Flow

### Browser-Initiated Reset

```
User resets chat session
    ↓
DELETE /chat/:id
    ↓
PiSessionBridge.reset()
    ↓
Dispose Pi session
    ↓
Next request lazily resumes a fresh session
```

### Idle Eviction

```
No activity for idle timeout window
    ↓
Session timer fires
    ↓
ChatSessionManager.evict()
    ↓
Dispose Pi session
    ↓
Free one local runtime slot
```

### Key Files

| File | Role |
|------|------|
| `core/chat-server/index.ts` | Reset endpoint |
| `core/chat-server/session.ts` | Eviction and disposal logic |
| `tests/chat-server/session.test.ts` | Session lifecycle coverage |

## Related

- [Memory Model](../reference/memory-model) - Memory system details
- [Daemon Architecture](../reference/daemon-architecture) - Runtime internals
- [Operations](../operations/) - Deployment and validation workflows
