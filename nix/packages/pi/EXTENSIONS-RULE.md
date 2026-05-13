# Canonical Rule: Pi Extensions on NixOS & NixPi

## The Problem

NixOS runs from a read-only `/nix/store`. Pi's package manager installs
user-scoped extensions via `npm install -g`, which writes to npm's _prefix_.
Out of the box on NixOS, that prefix is inside the read-only store, so every
`npm install -g` fails with EROFS/EACCES.

Pi's startup auto-installs any package listed in `settings.json.packages`
that it can't find in the npm global tree. This means a broken prefix blocks
_all_ extensions — not just new installs.

## The Rule

> **Pi extensions live in `~/.pi/npm-global`.** Three independent layers
> ensure `npm install -g` always writes there. All three must be in place:

| #   | Layer                | What it does                                             | Where it lives                | Why it's needed                                                                               |
| --- | -------------------- | -------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------- |
| 1   | **Wrapper `--run`**  | Exports `NPM_CONFIG_PREFIX` before every `pi` invocation | `nix/packages/pi/default.nix` | Catches interactive shells, scripts, and NixPi — anywhere the wrapper binary runs             |
| 2   | **Session variable** | Sets `NPM_CONFIG_PREFIX` in PAM/environment              | `pi-default-packages.nix`     | Catches bare `npm install -g` typed by the user; inherited by all child processes             |
| 3   | **`~/.npmrc`**       | Writes `prefix=~/.pi/npm-global` to npm's user config    | Created by activation script  | Last-resort fallback — npm reads this even if env vars are missing (e.g. `sudo -E`, `env -i`) |

If any one layer is missing, the other two cover the gap. If two are missing,
the third still works. All three together eliminate the class of bug entirely.

## How Extensions Get Installed

### On startup (automatic)

1. **Activation script** (`pi-default-packages.nix`) runs on `nixos-rebuild switch`:
   - Creates `~/.pi/agent/` and `~/.pi/npm-global/` (owned by alex:users)
   - Writes `~/.npmrc` with `prefix=/home/alex/.pi/npm-global`
   - Merges the declarative package list into `~/.pi/agent/settings.json`
     (only appends missing entries; never removes user-added packages)

2. **First `pi` launch** (after a rebuild or fresh VM):
   - Pi reads `settings.json.packages`
   - For each entry not yet in `~/.pi/npm-global/lib/node_modules/`, pi runs
     `npm install -g <spec>` — which now writes to the writable prefix
   - This is **intentional**: it's the only time `npm install -g` runs, and
     it must complete uninterrupted (no timeouts!)

### By the user (imperative)

```bash
pi install npm:some-extension     # writes to settings.json, npm install -g
pi install -l npm:some-extension  # project-local instead (into .pi/npm/)
pi -e npm:some-extension          # temporary — gone after the session
```

User-installed extensions persist in `~/.pi/npm-global` until manually removed
with `pi remove`. They survive `nixos-rebuild switch` because the activation
script only _appends_ to the packages list.

## Per-Environment Details

### A. NixOS host (nazar, alex-laptop)

```
pi-default-packages.nix  →  session variable + activation script + ~/.npmrc
         ↑ imported by
pi-agent.nix (common)    →  pi + nodejs in systemPackages
         ↑ imported by
host/pi-agent.nix        →  adds PI_TELEMETRY, PI_SKIP_VERSION_CHECK
```

**Current state:** All three layers present. `nodejs` in systemPackages
provides the `npm` and `node` binaries pi's package-manager spawns.

**Required in `environment.systemPackages`:**

- `pi` (the wrapped binary — includes `NPM_CONFIG_PREFIX` in its `--run`)
- `pkgs.nodejs` — so pi can run `npm install -g` for extensions

### B. NixPi VMs (systemd service)

```
nixpi.nix (common)       →  systemd.services.nixpi.environment.NPM_CONFIG_PREFIX
                               + path = [ nodejs_22 ]
         ↑ imported by
host/nixpi.nix           →  service definition, piBinary
```

**Critical difference from the host:** NixPi runs pi as a **systemd service**,
not in a PAM session. `environment.sessionVariables` is NOT available. The
service environment must explicitly set `NPM_CONFIG_PREFIX`.

**The pi wrapper's `--run` handles this** — when systemd executes
`${pi}/bin/pi`, the wrapper's `--run` exports `NPM_CONFIG_PREFIX` before the
real binary starts. The `systemd.services.nixpi.environment.NPM_CONFIG_PREFIX`
is a **belt-and-suspenders** duplicate that covers any subprocess npm
invocations spawned by pi outside the wrapper (e.g., the `npm install -g`
that pi's package-manager runs).

**Also required:**

- `path = [ pkgs.nodejs_22 ]` — npm must be in `$PATH` for pi to spawn it
- `~/.npmrc` written by the activation script (if `pi-default-packages.nix`
  is imported by the VM config)

### C. NixPi on the host (non-VM, local service)

Same as VM but runs on `127.0.0.1`. Same `NPM_CONFIG_PREFIX` requirement.

## The Extension Install Lifecycle

```
nixos-rebuild switch
        │
        ▼
 ┌─────────────────────────────────────────────┐
 │ Activation script runs (as root):           │
 │  1. mkdir -p ~/.pi/agent ~/.pi/npm-global   │
 │  2. Write ~/.npmrc with prefix              │
 │  3. Merge default packages → settings.json  │
 └─────────────────────┬───────────────────────┘
                       │
                       ▼
               First `pi` launch
                       │
                       ▼
 ┌─────────────────────────────────────────────┐
 │ Pi's package-manager (runs as alex):        │
 │  1. Read settings.json.packages            │
 │  2. Run `npm root -g` → find global dir    │
 │     (returns ~/.pi/npm-global/lib/n_m/)    │
 │  3. For each missing package:              │
 │     `npm install -g <spec>`                │
 │     (writes to writable prefix)            │
 └─────────────────────┬───────────────────────┘
                       │
                       ▼
         Extensions loaded, pi is ready
```

## Failure Recovery

### Symptom: `npm install -g` fails with ENOENT/EROFS pointing at `/nix/store`

**Cause:** `NPM_CONFIG_PREFIX` not set, or `~/.npmrc` missing.

**Fix:**

```bash
# Verify the three layers:
echo $NPM_CONFIG_PREFIX           # → /home/alex/.pi/npm-global
npm config get prefix              # → /home/alex/.pi/npm-global
cat ~/.npmrc                       # → prefix=/home/alex/.pi/npm-global
```

If any is wrong, re-run `nixos-rebuild switch` or manually:

```bash
npm config set prefix ~/.pi/npm-global
```

### Symptom: ENOTEMPTY / ENOENT during `npm install -g` (corrupted tree)

**Cause:** A previous install was interrupted (killed mid-unpack), leaving a
partially-written `node_modules/` directory. npm can't unpack over it or
clean it up.

**Fix:** Nuclear cleanup of the corrupted package, then reinstall:

```bash
rm -rf ~/.pi/npm-global/lib/node_modules/<package-name>
npm install -g <package-name>     # let it finish completely!
```

For a full reset:

```bash
rm -rf ~/.pi/npm-global/lib/node_modules/* ~/.pi/npm-global/bin/*
pi  # first launch re-installs everything from settings.json
```

### Symptom: `settings.json.lock` EROFS warning on startup

This is a harmless warning — pi tries to create a lockfile in `~/.pi/agent/`
and fails if the directory permissions are wrong. Verify ownership:

```bash
ls -la ~/.pi/agent/
# Should be: drwxr-xr-x alex users ... .pi/agent
```

## What NOT To Do

| ❌ Don't                                                      | ✅ Do instead                                                                     |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Run `npm install -g` without `NPM_CONFIG_PREFIX` set          | Verify with `npm config get prefix` first                                         |
| Kill `pi` during first launch (extensions installing)         | Let npm finish — pi-lens takes ~60s                                               |
| Build pi extensions as Nix derivations with `buildNpmPackage` | Let pi's own package-manager handle `npm install -g` at runtime                   |
| Install extensions as root in activation script               | Only write config dirs and `settings.json` as root; let pi (user) do npm installs |
| Use `programs.npm.npmrc` for the prefix                       | Use activation script + session var + wrapper — covers systemd too                |
| Remove `nodejs` from `systemPackages` or `path`               | Pi needs `npm` binary in `$PATH` to install extensions                            |

## Declarative Package List

The canonical list of default pi extensions is in one place:

```nix
# nix/modules/common/pi-default-packages.nix
defaultPiPackages = [
  "npm:pi-subagents"
  "npm:context-mode"
  "npm:pi-web-access"
  "npm:pi-lens"
  "npm:@aliou/pi-synthetic"
];
```

To add a new default extension:

1. Add it to `defaultPiPackages` in `pi-default-packages.nix`
2. Run `nixos-rebuild switch` — activation script merges it into `settings.json`
3. Next `pi` launch auto-installs it via `npm install -g`

To remove a default extension:

1. Remove it from `defaultPiPackages`
2. **Also** manually remove it from `~/.pi/agent/settings.json` (activation
   script only appends, never removes)
3. Optionally: `pi remove npm:<name>` to uninstall the npm package too

## File Layout

```
~/.pi/
├── agent/
│   ├── settings.json          ← pi config, includes packages list
│   ├── settings.json.lock     ← created by pi at runtime (may warn on EROFS)
│   ├── auth.json              ← API keys
│   └── git/                   ← git-sourced extensions
├── npm-global/                ← NPM_CONFIG_PREFIX target (writable)
│   ├── bin/                   ← CLI entrypoints (symlinks into lib/n_m/)
│   │   ├── context-mode → ../lib/node_modules/context-mode/cli.bundle.mjs
│   │   ├── pi-subagents  → ../lib/node_modules/pi-subagents/install.mjs
│   │   └── pi-lens        → ...
│   └── lib/
│       └── node_modules/
│           ├── context-mode/
│           ├── pi-subagents/
│           ├── pi-web-access/
│           ├── @aliou/
│           │   └── pi-synthetic/
│           └── pi-lens/
└── npm/                       ← project-local extensions (if any)
```
