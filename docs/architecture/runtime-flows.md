# NixPI Runtime Flows

> End-to-end flows through the NixPI system

## 🌱 Why Document Runtime Flows

Understanding how control and data flow through NixPI is essential for:
- Debugging issues that span subsystems
- Adding new features that integrate correctly
- Understanding failure modes and recovery paths

## 🚀 Install/Build Flow

### Entry Points

| Entry Point | Command | Purpose |
|-------------|---------|---------|
| Local build | `nix build .#app` | Build TypeScript app derivation |
| System switch | `just switch` | Apply local flake to running system |
| Remote update | `just update` | Apply remote flake to running system |

### Flow Steps

1. **Nix evaluation** (`flake.nix`)
   - Imports NixPI modules
   - Resolves `piAgent` and `appPackage` derivations
   - Builds system closure

2. **TypeScript compilation** (`npm run build`)
   - Compiles `core/**/*.ts` to `dist/`
   - Extension discovery from `package.json` `pi.extensions`

3. **Service installation**
   - `nixpi-daemon.service` enabled
   - `nixpi-home.service`, `nixpi-element-web.service` configured
   - Matrix Continuwuity provisioned

### Key Files

| File | Role |
|------|------|
| `flake.nix` | Entry point, module aggregation |
| `core/os/modules/app.nix` | App packaging and service |
| `core/os/pkgs/app/default.nix` | Package derivation |
| `package.json` | Extension manifest, dependencies |

## 💻 Boot/Service Startup Flow

### System Boot Sequence

```
systemd boot
    ↓
multi-user.target
    ↓
├─ continuwuity.service
├─ netbird.service
├─ nixpi-home.service
├─ nixpi-element-web.service
└─ nixpi-daemon.service (after setup complete)
```

### Daemon Startup Flow

1. **Config loading** (`core/daemon/config.ts`)
   - Reads environment variables
   - Loads agent overlays from `~/nixpi/Agents/`

2. **Registry initialization** (`core/daemon/agent-registry.ts`)
   - Scans `AGENTS.md` files
   - Validates overlay structure
   - Synthesizes default host agent if needed

3. **Runtime bootstrap** (`core/daemon/multi-agent-runtime.ts`)
   - Creates Matrix client per agent
   - Initializes room state manager
   - Starts scheduler for proactive jobs

4. **Message loop** (`core/daemon/runtime/matrix-js-sdk-bridge.ts`)
   - Listens for Matrix events
   - Routes to appropriate session

### Key Files

| File | Role |
|------|------|
| `core/daemon/index.ts` | Bootstrap entry point |
| `core/daemon/lifecycle.ts` | Startup retry/backoff |
| `core/daemon/agent-registry.ts` | Agent overlay loading |
| `core/daemon/multi-agent-runtime.ts` | Runtime orchestration |

## 🧩 First-Boot/Setup Flow

### Phase 1: Bash Wizard

**Entry**: Openbox desktop autologin opens the NixPI terminal

```
LightDM autologin
    ↓
Openbox session
    ↓
NixPI terminal
    ↓
setup-wizard.sh
    ↓
├─ Password change
├─ WiFi / internet setup
├─ Clone ~/nixpi
├─ Write /etc/nixos host flake
├─ nixos-rebuild switch to full appliance
├─ NetBird enrollment
├─ Matrix account bootstrap
├─ AI provider defaults
└─ Enable nixpi-daemon.service
```

### Phase 2: Pi Persona Step

**Entry**: Opening Pi after wizard completes

```
Pi session start
    ↓
check persona-done marker
    ↓
Pending "persona" step?
    ↓
Yes: Inject persona guidance
     No: Normal conversation
```

### State Files

| File | Purpose |
|------|---------|
| `~/.nixpi/.setup-complete` | Wizard completion sentinel |
| `~/.nixpi/wizard-state/persona-done` | Persona step marker |

### Key Files

| File | Role |
|------|------|
| `core/pi/extensions/persona/` | Persona setup prompt injection |
| `core/scripts/` | First-boot scripts |

## 📡 Matrix Room Message Flow

### Incoming Message Flow

```
Matrix homeserver
    ↓
matrix-js-sdk-bridge.ts
    ↓
router.ts (routing decision)
    ↓
├─ Duplicate? → Drop
├─ Cooldown active? → Queue/delay
└─ Route to session
    ↓
pi-room-session.ts
    ↓
Pi session processes message
    ↓
Response sent via bridge
```

### Routing Rules

| Condition | Action |
|-----------|--------|
| Host mode only | Route to default agent |
| Explicit mention | Route to mentioned agent |
| First eligible | Route to first non-cooldown agent |
| Reply budget exhausted | Queue or drop |

### Key Files

| File | Role |
|------|------|
| `core/daemon/router.ts` | Message routing logic |
| `core/daemon/room-state.ts` | Per-room state tracking |
| `core/daemon/runtime/pi-room-session.ts` | Session lifecycle |
| `core/daemon/runtime/matrix-js-sdk-bridge.ts` | Matrix transport |

## 🗂️ Memory/Object Flow

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

## 🔄 Update/Proposal Flow

### Local Proposal Flow

```
Pi proposes change
    ↓
Edit files in ~/.nixpi/pi-nixpi/
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
| `core/os/services/nixpi-update.nix` | Update timer/service |

## 📊 Proactive Job Flow

### Heartbeat Job Flow

```
Scheduler tick
    ↓
Job due (interval_minutes elapsed)?
    ↓
Rate limit check
    ↓
Circuit breaker closed?
    ↓
Dispatch proactive turn
    ↓
Record execution time
    ↓
Quiet if noop? + matches no_op_token? → Suppress reply
```

### Cron Job Flow

```
Scheduler tick (every minute)
    ↓
Parse cron expression
    ↓
Current time matches?
    ↓
Dispatch proactive turn
```

### Key Files

| File | Role |
|------|------|
| `core/daemon/scheduler.ts` | Job scheduling |
| `core/daemon/proactive.ts` | Dispatch logic |
| `core/daemon/rate-limiter.ts` | Rate limiting |

## 🔗 Related

- [Daemon Architecture](../reference/daemon-architecture) - Detailed daemon documentation
- [Memory Model](../reference/memory-model) - Memory system details
- [Codebase: Daemon](../codebase/daemon) - Daemon file inventory
