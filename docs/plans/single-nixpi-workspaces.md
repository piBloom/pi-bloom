# Plan: Single NixPi Instance with Multi-Workspace Architecture

## Current State

```
┌─────────────────────────────────────────────────────┐
│                   Nazar Host                          │
│  ┌──────────────┐                                    │
│  │ NixPi :4815  │ ← nazar.studio/nixpi/             │
│  │ CWD=/home/alex│                                   │
│  └──────────────┘                                    │
│         │                                            │
│    ┌────┴──────────────────────┐                     │
│    │   nginx reverse proxy      │                    │
│    │   per-VM /nixpi/ routes    │                    │
│    └────┬──────────────────────┘                     │
│         │                                            │
│  ┌──────┴──────┐ ┌──────────┐ ┌───────────┐        │
│  │ git VM      │ │ mc VM    │ │ dav VM    │        │
│  │ NixPi :4815│ │NixPi:4815│ │NixPi:4815 │        │
│  │CWD=nazar/  │ │CWD=mc/   │ │CWD=dav/   │        │
│  └────────────┘ └──────────┘ └───────────┘        │
└─────────────────────────────────────────────────────┘
```

**Problems:**

- 4 separate NixPi processes (1 host + 3 VMs), each with its own systemd service
- 4 separate Pi `--mode rpc` child processes
- NixPi is a 1:1 wrapper — one CWD, one pi subprocess per instance
- nginx routes `/nixpi/` per-VM domain but it's really a different server each time
- VMs need `host = "0.0.0.0"` + firewall rules just so the host nginx can proxy to them
- Each VM carries the full nixpi package + pi binary + nodejs runtime
- Session state is siloed per-VM (can't see minecraft sessions from host nixpi)

## Proposed Architecture

```
┌──────────────────────────────────────────────────────┐
│                      Nazar Host                       │
│                                                       │
│  ┌──────────────────────────────────────────────────┐ │
│  │  NixPi :4815  (single instance)                  │ │
│  │  nixpi.nazar.studio                              │ │
│  │                                                   │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐          │ │
│  │  │Workspace:│ │Workspace:│ │Workspace:│          │ │
│  │  │ nazar    │ │minecraft │ │dav-server│          │ │
│  │  │CWD=~/nazar│CWD=~/mc │ │CWD=~/dav │          │ │
│  │  │pi=rpi→  │ │pi=rpi→  │ │pi=rpi→   │          │ │
│  │  │ ssh://git│ ssh://mc │ │ ssh://dav│          │ │
│  │  └──────────┘ └──────────┘ └──────────┘          │ │
│  └──────────────────────────────────────────────────┘ │
│       │                                               │
│  ┌────┴─────────────────────────────────────────────┐│
│  │  nginx: nixpi.nazar.studio → localhost:4815      ││
│  └──────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────┘
```

**Key insight:** Instead of running Pi inside each VM, run Pi on the **host** with each workspace connecting to the VM over **SSH** — nixpi spawns `ssh alex@10.10.10.30 pi --mode rpc` to tunnel pi's JSON-RPC over SSH.

## Workspace Concept

A **workspace** is a named profile in nixpi that maps to:

1. A **working directory** (CWD) on the host
2. A **Pi connection mode** — local or remote (SSH to a VM)
3. A **session namespace** — sessions are stored per-workspace, not globally
4. A **model/thinking preferences** — can vary per workspace
5. A **context description** — shown in the UI to identify the workspace

### Example Workspaces

| Workspace  | CWD                     | Connection          | Context                            |
| ---------- | ----------------------- | ------------------- | ---------------------------------- |
| nazar      | `/home/alex/nazar`      | local (host)        | Infrastructure repo on the host    |
| minecraft  | `/home/alex/minecraft`  | SSH → `10.10.10.30` | Minecraft VM, PaperMC server       |
| dav-server | `/home/alex/dav-server` | SSH → `10.10.10.41` | DAV server VM                      |
| git        | `/home/alex/nazar`      | SSH → `10.10.10.21` | Forgejo VM (same repo, remote ops) |

## Implementation Plan

### Phase 1: NixPi Workspace Support (nixpi repo)

The current nixpi server.js has a single global `CWD`, `PI_BIN`, and one `piProc`. We need to refactor it to support multiple workspaces.

#### 1.1 Workspace Configuration File

Add a workspace config file at `~/.pi/workspaces.json`:

```json
{
  "default": "nazar",
  "workspaces": {
    "nazar": {
      "cwd": "/home/alex/nazar",
      "mode": "local",
      "context": "Nazar infrastructure (host)",
      "model": null,
      "thinkingLevel": "medium"
    },
    "minecraft": {
      "cwd": "/home/alex/minecraft",
      "mode": "ssh",
      "sshHost": "10.10.10.30",
      "sshUser": "alex",
      "context": "Minecraft PaperMC server VM",
      "model": null,
      "thinkingLevel": "medium"
    },
    "dav-server": {
      "cwd": "/home/alex/dav-server",
      "mode": "ssh",
      "sshHost": "10.10.10.41",
      "sshUser": "alex",
      "context": "DAV/CalDAV/CardDAV server VM",
      "model": null,
      "thinkingLevel": "medium"
    }
  }
}
```

#### 1.2 Multi-Instance Pi Manager

Refactor the single `piProc` into a `WorkspaceManager`:

```javascript
class WorkspaceManager {
  // Map of workspace name → { piProc, busy, sessionId, model, ... }
  workspaces = new Map();
  activeWorkspace = null;

  ensureWorkspace(name) {
    /* spawn pi for this workspace */
  }
  switchTo(name) {
    /* set active, notify clients */
  }
  sendPrompt(text, opts) {
    /* route to active workspace's piProc */
  }
}
```

Each workspace gets its own `pi --mode rpc` subprocess (or `pi --host ssh://... --mode rpc` for remote VMs). Only the **active** workspace's pi process needs to be running; others can be lazily started or kept idle.

#### 1.3 UI Changes

- **Workspace switcher** in the top bar (dropdown or tabs)
- **Session list** scoped to active workspace
- **Status indicator** per workspace (connected/disconnected/busy)
- No workspace creation/deletion UI (Nix-managed only)

#### 1.4 API Changes

New WebSocket message types:

- `switch_workspace` — change active workspace
- `list_workspaces` — get all configured workspaces with status

### Phase 2: NixOS Module Changes (nazar repo)

#### 2.1 Host NixPi Module (`nix/modules/host/nixpi.nix`)

Enhance with workspace configuration:

```nix
services.nixpi = {
  enable = true;
  host = "127.0.0.1";
  port = 4815;
  workspaces = {
    nazar = {
      cwd = "/home/alex/nazar";
      mode = "local";
      context = "Nazar infrastructure (host)";
    };
    minecraft = {
      cwd = "/home/alex/minecraft";
      mode = "ssh";
      sshHost = "10.10.10.30";
      context = "Minecraft PaperMC server VM";
    };
    dav-server = {
      cwd = "/home/alex/dav-server";
      mode = "ssh";
      sshHost = "10.10.10.41";
      context = "DAV server VM";
    };
  };
};
```

The NixOS module would generate `~/.pi/workspaces.json` from this config.

#### 2.2 Remove VM-side NixPi

- Remove `nix/modules/common/nixpi.nix` from guest modules
- Remove nixpi-related `microvm.shares` (the `*-pi` virtiofs shares)
- Remove VM-side `openFirewall` and `firewallAllowedSources` for port 4815
- Keep `pi-agent.nix` as opt-in (see 2.5)

#### 2.3 Update Exposure (`nix/fleet/exposure.nix`)

Replace per-VM nixpi routes with a single domain:

```nix
host = {
  nixpi = {
    enable = true;
    domain = "nixpi.nazar.studio";  # dedicated subdomain
    port = 4815;
    access = "private";
  };
  # Remove all vms.*.nixpi entries
};
# vms.*.nixpi → all removed
```

Add DNS record: `nixpi.nazar.studio → A record` (or CNAME to nazar.studio).

#### 2.4 SSH Connectivity

Pi has no built-in `--host` flag. Remote workspaces use **SSH tunnelling**:
nixpi spawns `ssh alex@10.10.10.30 pi --mode rpc` instead of a local pi
process. The SSH connection carries pi's JSON-RPC stdin/stdout back to nixpi.

Requirements:

- Host → VM SSH works (key-based, no password)
- The host `alex` user's SSH key (`alex@nazar`) must be in VMs' `authorized_keys`
  → Added to `nix/users/admin-keys.nix`
- `openssh` must be in the nixpi systemd unit's `path` for the `ssh` binary
  → Added to nixpi NixOS module and nazar host module
- `StrictHostKeyChecking=accept-new` for first-connection host key acceptance
- `ServerAliveInterval=30` / `ServerAliveCountMax=3` for keepalive

#### 2.5 Make pi-agent opt-in in VMs

Keep `pi-agent.nix` available but make it opt-in per VM:

```nix
vm.piAgent = {
  enable = lib.mkDefault false;
  port = 4815;
  workingDirectory = "/home/alex/${repoName}";
};
```

Defaults to `false` after migration. Enable explicitly for VMs where you
want direct `pi` access over SSH.

### Phase 3: Workspace-Aware Session Storage

Currently sessions are keyed by CWD path:

```
~/.pi/agent/sessions/--home-alex-nazar--/*.jsonl
```

With workspaces, we want:

```
~/.pi/agent/sessions/--ws-nazar--/*.jsonl
~/.pi/agent/sessions/--ws-minecraft--/*.jsonl
```

This requires either:

- **Option A**: Pi itself supports a `--workspace` flag that sets the session key
- **Option B**: NixPi manages session routing itself (set CWD per workspace, sessions naturally separate)
- **Option C**: Symlink different CWDs per workspace on the host

Option B is simplest — since each workspace has its own CWD, Pi's existing
session-key-by-CWD behavior naturally separates sessions.

### Phase 4: Host Repo Mounts

For SSH-mode workspaces, the host needs the VM's repo cloned locally (for file
browsing, session storage, etc.) while Pi executes remotely.

Two approaches:

1. **Host-side clone + remote execution**: Clone the repo on the host at the
   workspace CWD. Pi uses `--host ssh://...` to execute on the VM but the host
   has the repo for nixpi's session/file browsing.
2. **Pure remote**: No local clone. nixpi SSHes into the VM, and all file ops
   happen remotely. More complex nixpi changes.

Recommendation: **Approach 1** — keep local clones on the host, use Pi's remote
execution. This is simpler and gives nixpi local file access for the UI.

## Confirmed Decisions

### 1. Workspace Management: Nix-managed only ✅

- Workspaces defined exclusively in NixOS config, generated at build time
- No runtime workspace creation/deletion from the UI
- Consistent with the declarative NixOS philosophy
- Changes require a `nixos-rebuild switch`

### 2. VM Pi Agent: Keep, opt-in ✅

- Keep `pi-agent.nix` available but make it opt-in per VM
- `vm.piAgent.enable` defaults to `false` after migration
- Allows SSH into a VM and running `pi` locally for debugging

### 3. Remote Connection: SSH ✅

- Use `pi --host ssh://...` for remote VM workspaces
- Keep local clones on host for nixpi file browsing / sessions
- Remove `*-pi` virtiofs shares (no longer needed)

### 4. Pi Spawning: Lazy, active-only ✅

- Only spawn `pi --mode rpc` for the active workspace
- Auto-kill after configurable idle timeout (default: 5 minutes)
- On workspace switch: start new pi, kill old after grace period

### 5. Domain: `nixpi.nazar.studio` ✅

- Dedicated subdomain, no path-prefix rewriting
- Single DNS A record pointing to host public IP
- Simpler CORS, simpler nginx config

## Migration Steps (Ordered)

1. ~~**Add workspace config to nixpi**~~ — ✅ done (server.js: WORKSPACES_CONFIG, IDLE_TIMEOUT_MS)
2. ~~**Add WorkspaceManager**~~ — ✅ done (WorkspaceManager class, lazy spawn, idle kill)
3. ~~**Add workspace UI**~~ — ✅ done (select dropdown in header, switch handler)
4. ~~**Update nixpi NixOS module**~~ — ✅ done (services.nixpi.workspaces, .idleTimeoutMs, .defaultWorkspace)
5. ~~**Add `nixpi.nazar.studio` DNS + nginx**~~ — ✅ done (exposure.nix, forgejo-proxy.nix updated)
6. ~~**Generate workspaces.json from NixOS config**~~ — ✅ done (workspacesJson in nixpi module, NIXPI_WORKSPACES_CONFIG env)
7. ~~**Remove VM nixpi instances**~~ — ✅ done (removed from commonGuestModules, exposure, flake.nix)
8. ~~**Remove VM virtiofs pi shares**~~ — ✅ done (removed git-pi, minecraft-pi, dav-server-pi from vms.nix)
9. ~~**Make VM pi-agent opt-in**~~ — ✅ done (vm.piAgent.enable, conditional import in microvm-host.nix)
10. ~~**Ensure SSH host→VM connectivity**~~ — ✅ done (SSH with `-T` verified, admin-keys.nix updated, openssh in PATH)
11. ~~**Test each workspace**~~ — ✅ done (nixpi running, 4 workspaces visible, nazar active+connected, SSH RPC to all 3 VMs verified)
12. ~~**Update nazar-context**~~ — ✅ done (removed nixpi from self-flake, removed from commonVmModules)
13. **Clean up** — 🔲 remove deprecated nixpi.nix guest module after migration, remove context-mode plugin
