# Full Nix Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the plaintext WiFi PSK footgun, move the Sway config to a Nix-managed file, add a dev shell for contributors, and wire up Cachix so on-device updates take minutes instead of hours.

**Architecture:** Four independent NixOS config changes touching `bloom-network.nix`, `bloom-shell.nix`, `flake.nix`, `bloom-update.nix`, and `.github/workflows/build-os.yml`. Each task is self-contained and produces a working system. Tasks 1–3 require no external setup; Task 4 requires a Cachix account created first.

**Tech Stack:** NixOS modules, Nix flakes, GitHub Actions, Cachix

**Spec:** `docs/superpowers/specs/2026-03-18-full-nix-modernization-design.md`

---

## File Map

| File | Change |
|------|--------|
| `core/os/modules/bloom-network.nix` | Remove `options.bloom.wifi` block + nmconnection `environment.etc` block |
| `core/os/modules/bloom-shell.nix` | Add `environment.etc."xdg/sway/config"`, remove Sway heredoc from `.bash_profile`, remove `XDG_RUNTIME_DIR` from `.bashrc` |
| `flake.nix` | Add `devShells.${system}.default` output |
| `core/os/modules/bloom-update.nix` | Uncomment + fill in Cachix substituters |
| `.github/workflows/build-os.yml` | Add `cachix/cachix-action` step + explicit `bloom-config` build step |

---

## Verification Commands

Used throughout. Run these to check NixOS evaluation doesn't break:

```bash
# Fast: evaluates the full installed-system config (catches module errors, bad references)
nix build .#checks.x86_64-linux.bloom-config

# Even faster: just evaluate without building
nix eval .#nixosConfigurations.bloom-installed-test.config.system.stateVersion
```

---

## Task 1: Remove WiFi NixOS Option

**Files:**
- Modify: `core/os/modules/bloom-network.nix`

### Context

`bloom-network.nix` currently has:
- An `options.bloom.wifi` block (lines 5–8) declaring `ssid` and `psk` options
- Inside `config = { ... }`, an `environment.etc."NetworkManager/system-connections/wifi.nmconnection"` block (lines 31–54) that writes the PSK to the Nix store in plaintext when `ssid != ""`

WiFi is already configured by Calamares at install time and by `bloom-wizard.sh` at first boot — neither path touches the Nix config. The NixOS option is a footgun with no callers.

### Steps

- [ ] **Step 1: Verify baseline eval passes**

  ```bash
  nix eval .#nixosConfigurations.bloom-installed-test.config.system.stateVersion
  ```

  Expected: prints `"25.05"` with no errors.

- [ ] **Step 2: Remove the `options.bloom.wifi` block from `bloom-network.nix`**

  Delete these lines from `core/os/modules/bloom-network.nix`:

  ```nix
  options.bloom.wifi = {
    ssid = lib.mkOption { type = lib.types.str; default = ""; description = "WiFi SSID (empty = disabled)"; };
    psk  = lib.mkOption { type = lib.types.str; default = ""; description = "WiFi PSK"; };
  };
  ```

  The file uses `options` and `config` at the top level. After removing the `options` block, the file should only have a `config = { ... }` block.

- [ ] **Step 3: Remove the nmconnection `environment.etc` block**

  Inside the `config = { ... }` block, delete:

  ```nix
  # TODO: PSK is stored in the Nix store in plaintext when set. Use sops-nix or
  # agenix for production deployments. WiFi is disabled by default (ssid = "").
  environment.etc."NetworkManager/system-connections/wifi.nmconnection" =
    lib.mkIf (config.bloom.wifi.ssid != "") {
      mode = "0600";
      text = ''
        [connection]
        id=${config.bloom.wifi.ssid}
        type=wifi
        autoconnect=true

        [wifi]
        mode=infrastructure
        ssid=${config.bloom.wifi.ssid}

        [wifi-security]
        key-mgmt=wpa-psk
        psk=${config.bloom.wifi.psk}

        [ipv4]
        method=auto

        [ipv6]
        method=auto
      '';
    };
  ```

  Also remove `config` from the function signature — it is no longer referenced anywhere in the file after this deletion. Change `{ pkgs, lib, config, ... }:` to `{ pkgs, lib, ... }:`.

- [ ] **Step 4: Verify eval still passes**

  ```bash
  nix eval .#nixosConfigurations.bloom-installed-test.config.system.stateVersion
  ```

  Expected: `"25.05"` with no errors.

- [ ] **Step 5: Commit**

  ```bash
  git add core/os/modules/bloom-network.nix
  git commit -m "fix(nix): remove plaintext WiFi PSK option from NixOS config

  WiFi is configured by the Calamares installer and bloom-wizard.sh.
  The NixOS option stored the PSK in the Nix store in plaintext."
  ```

---

## Task 2: Move Sway Config to Nix + Shell Cleanup

**Files:**
- Modify: `core/os/modules/bloom-shell.nix`

### Context

`bloom-shell.nix` has three problems to fix:

1. **Sway config in bash heredoc** (lines 33–137 of `bashProfile`): A bash `if [ ! -f ~/.config/sway/config ]` block writes the full Sway config on first login. It's not updated by `nixos-rebuild switch`.

2. **`XDG_RUNTIME_DIR` manually set** (line 9 of `bashrc`): `export XDG_RUNTIME_DIR="/run/user/$(id -u)"` — NixOS sets this automatically via `pam_systemd`. Manual override is redundant.

**Sway config lookup order** (important): Sway checks `$SWAY_CONFIG` → `~/.config/sway/config` → `~/.sway/config` → `/etc/xdg/sway/config` → `/etc/sway/config`. We use `environment.etc."xdg/sway/config"` which maps to `/etc/xdg/sway/config` — the correct system-wide location on NixOS.

**Migration note**: Existing installs with `~/.config/sway/config` already written will continue using that file (user config takes precedence). That's fine — the file content is identical.

### Steps

- [ ] **Step 0: Verify baseline eval passes**

  ```bash
  nix eval .#nixosConfigurations.bloom-installed-test.config.system.stateVersion
  ```

  Expected: `"25.05"` with no errors.

- [ ] **Step 1: Add `environment.etc."xdg/sway/config"` to `bloom-shell.nix`**

  In the `{ ... }` attrset returned by the module (where `users.users`, `environment.etc`, etc. live), add:

  ```nix
  environment.etc."xdg/sway/config".text = ''
    # Bloom OS Sway Configuration
    set $mod Mod4
    set $term foot
    set $menu wmenu-run

    # Font for window titles
    font pango:monospace 10

    # Use Mouse+$mod to drag floating windows
    floating_modifier $mod normal

    # Start terminal
    bindsym $mod+Return exec $term

    # Kill focused window
    bindsym $mod+Shift+q kill

    # Start launcher
    bindsym $mod+d exec $menu

    # Reload configuration
    bindsym $mod+Shift+c reload

    # Exit Sway
    bindsym $mod+Shift+e exec swaynag -t warning -m 'Exit Sway?' -B 'Yes' 'swaymsg exit'

    # Move focus
    bindsym $mod+h focus left
    bindsym $mod+j focus down
    bindsym $mod+k focus up
    bindsym $mod+l focus right

    # Move windows
    bindsym $mod+Shift+h move left
    bindsym $mod+Shift+j move down
    bindsym $mod+Shift+k move up
    bindsym $mod+Shift+l move right

    # Workspaces
    bindsym $mod+1 workspace number 1
    bindsym $mod+2 workspace number 2
    bindsym $mod+3 workspace number 3
    bindsym $mod+4 workspace number 4
    bindsym $mod+5 workspace number 5

    # Move to workspace
    bindsym $mod+Shift+1 move container to workspace number 1
    bindsym $mod+Shift+2 move container to workspace number 2
    bindsym $mod+Shift+3 move container to workspace number 3
    bindsym $mod+Shift+4 move container to workspace number 4
    bindsym $mod+Shift+5 move container to workspace number 5

    # Layout
    bindsym $mod+b splith
    bindsym $mod+v splitv
    bindsym $mod+s layout stacking
    bindsym $mod+w layout tabbed
    bindsym $mod+e layout toggle split

    # Fullscreen
    bindsym $mod+f fullscreen toggle

    # Floating
    bindsym $mod+Shift+space floating toggle
    bindsym $mod+space focus mode_toggle

    # Resize mode
    mode "resize" {
        bindsym h resize shrink width 10px
        bindsym j resize grow height 10px
        bindsym k resize shrink height 10px
        bindsym l resize grow width 10px
        bindsym Return mode "default"
        bindsym Escape mode "default"
    }
    bindsym $mod+r mode "resize"

    # Brightness and volume keys
    bindsym XF86MonBrightnessUp exec brightnessctl set +5%
    bindsym XF86MonBrightnessDown exec brightnessctl set 5%-
    bindsym XF86AudioRaiseVolume exec pamixer -i 5
    bindsym XF86AudioLowerVolume exec pamixer -d 5
    bindsym XF86AudioMute exec pamixer -t

    # Status bar
    bar {
        position top
        status_command while date +'%Y-%m-%d %H:%M:%S'; do sleep 1; done
        colors {
            statusline #ffffff
            background #323232
        }
    }

    # Window borders
    default_border pixel 2
    default_floating_border pixel 2

    # Autostart Pi in a terminal
    exec $term -e bash -c 'bloom-greeting.sh && exec pi'
  '';
  ```

  This is identical content to the heredoc — just moved to a proper `environment.etc` entry. The trailing `''` must use Nix string syntax (double single-quotes).

  **Indentation note:** Nix indented strings (`''...''`) strip leading whitespace based on the least-indented line. The content above is shown with 4-space indentation for readability inside the plan — in the actual file you can indent it however fits the surrounding Nix code. The resulting `/etc/xdg/sway/config` will have no leading indentation on any line, which is correct and matches the original heredoc (which also had no leading whitespace).

- [ ] **Step 2: Remove the Sway heredoc block from `bashProfile`**

  In the `bashProfile` `pkgs.writeText` block (lines 14–149 of `bloom-shell.nix`), delete lines 33–137 inclusive. The block to delete starts with:

  ```bash
      # Create minimal Sway config if none exists
      if [ ! -f "$HOME/.config/sway/config" ]; then
  ```

  and ends with the closing `fi` before `exec sway`:

  ```bash
      fi
  ```

  (That `fi` closes the `if [ ! -f ... ]` block. Do **not** delete the `fi` on line 141 — that closes the outer `if [ "$(tty)" = "/dev/tty1" ]` block, which must be kept.)

  After the deletion, the TTY1 block should look like:

  ```bash
      if [ "$(tty)" = "/dev/tty1" ] && [ -f "$HOME/.bloom/.setup-complete" ]; then
        export XDG_SESSION_TYPE=wayland
        export XDG_CURRENT_DESKTOP=sway
        export MOZ_ENABLE_WAYLAND=1
        export QT_QPA_PLATFORM=wayland
        export SDL_VIDEODRIVER=wayland
        export _JAVA_AWT_WM_NONREPARENTING=1

        exec sway
      fi
  ```

- [ ] **Step 3: Remove `XDG_RUNTIME_DIR` from `bashrc`**

  In the `bashrc` `pkgs.writeText` block, delete:

  ```bash
    export XDG_RUNTIME_DIR="/run/user/$(id -u)"
  ```

  The remaining lines (`BLOOM_DIR`, `BROWSER`, `PATH`) stay as-is.

- [ ] **Step 4: Verify eval passes**

  ```bash
  nix eval .#nixosConfigurations.bloom-installed-test.config.system.stateVersion
  ```

  Expected: `"25.05"` with no errors.

- [ ] **Step 5: Verify the Sway config is in the evaluated system**

  ```bash
  nix eval --raw .#nixosConfigurations.bloom-installed-test.config.environment.etc."xdg/sway/config".text | head -5
  ```

  Expected: first few lines of the Sway config (the `# Bloom OS Sway Configuration` comment and `set $mod Mod4`).

- [ ] **Step 6: Commit**

  ```bash
  git add core/os/modules/bloom-shell.nix
  git commit -m "fix(nix): move Sway config to environment.etc, drop manual XDG_RUNTIME_DIR

  Sway config was written by bash on first login and never updated by
  nixos-rebuild. Moved to environment.etc.xdg/sway/config so it is
  managed declaratively. Removed manual XDG_RUNTIME_DIR export which
  NixOS sets automatically via pam_systemd."
  ```

---

## Task 3: Add Dev Shell

**Files:**
- Modify: `flake.nix`

### Context

`flake.nix` currently has no `devShells` output. Contributors need Node, TypeScript, vitest, biome, shellcheck, jq, and just — some are in `environment.systemPackages` (requiring a full OS install), some aren't available outside the OS at all. `nix develop` will give any contributor a complete environment instantly, on any machine with Nix.

The dev shell is **additive** — it does not change `environment.systemPackages` in `bloom-network.nix`.

### Steps

- [ ] **Step 1: Verify baseline flake eval**

  ```bash
  nix flake check --no-build 2>&1 | head -20
  ```

  This should complete without errors (warnings are OK). Note any existing warnings for comparison.

- [ ] **Step 2: Add `devShells` output to `flake.nix`**

  In `flake.nix`, inside the `outputs = { self, nixpkgs, disko, ... }: let ... in { ... }` attrset, add alongside `packages.${system}` and `nixosModules`:

  ```nix
  devShells.${system}.default = pkgs.mkShell {
    packages = with pkgs; [
      # JavaScript / TypeScript
      nodejs
      typescript
      biome

      # Testing & linting
      vitest
      shellcheck

      # Utilities
      jq
      curl
      git
      just
    ];

    shellHook = ''
      echo "Bloom OS dev shell — run 'npm install' to set up JS dependencies"
      echo "Tools: node $(node --version), tsc $(tsc --version), just $(just --version | head -1)"
    '';
  };
  ```

  Both `pkgs.biome` and `pkgs.vitest` are top-level packages in nixpkgs unstable (biome is a Rust binary, vitest is packaged directly). Do not use `nodePackages.biome` or `nodePackages.vitest` — those are stale or absent in current nixpkgs.

- [ ] **Step 3: Evaluate the dev shell**

  ```bash
  nix eval .#devShells.x86_64-linux.default.name
  ```

  Expected: prints `"nix-shell"` (the default mkShell name) with no errors.

- [ ] **Step 4: Enter the dev shell and verify tools**

  ```bash
  nix develop --command bash -c "node --version && tsc --version && biome --version && vitest --version && shellcheck --version && jq --version && just --version"
  ```

  Expected: version strings for all tools printed without errors. If any package name was wrong (e.g., biome not found), fix the package name and re-run step 3.

- [ ] **Step 5: Commit**

  ```bash
  git add flake.nix
  git commit -m "feat(nix): add devShells.default for contributor onboarding

  Running 'nix develop' now provides node, typescript, vitest, shellcheck,
  biome, jq, just, and curl — no Bloom OS install required."
  ```

---

## Task 4: Cachix Binary Cache

**Files:**
- Modify: `core/os/modules/bloom-update.nix`
- Modify: `.github/workflows/build-os.yml`

### Context

`bloom-update.nix` has a commented-out TODO for Cachix substituters. Without them, every `nixos-rebuild` on-device compiles from source (20–60+ minutes). With Cachix, pre-built binaries are fetched in minutes.

**This task requires manual external setup before the code changes.** Do Step 1 before touching any files.

### Steps

- [ ] **Step 1: Create Cachix cache (manual, external)**

  1. Sign up at https://app.cachix.org (free for public repos)
  2. Create a new cache named `bloom-os`
  3. On the cache settings page, find:
     - **Substituter URL**: `https://bloom-os.cachix.org`
     - **Public key**: something like `bloom-os.cachix.org-1:AAAA...=`
  4. Generate an **auth token** for pushing: Settings → Auth Tokens → Create Token
  5. Add the auth token to GitHub Actions secrets:
     - Go to the repo on GitHub → Settings → Secrets and variables → Actions
     - Add secret named `CACHIX_AUTH_TOKEN` with the token value

  Keep the public key handy — you'll use it in Step 2.

- [ ] **Step 2: Fill in substituters in `bloom-update.nix`**

  Replace the commented-out TODO block:

  ```nix
  # TODO: replace <cachix-url> and <cachix-pubkey> with real Cachix cache values
  # nix.settings.substituters = [ "https://cache.nixos.org" "<cachix-url>" ];
  # nix.settings.trusted-public-keys = [ "cache.nixos.org-1:6NCHdD59X431o0gWypbMrAURkbJ16ZPMQFGspcDShjY=" "<cachix-pubkey>" ];
  ```

  With:

  ```nix
  nix.settings.substituters = [
    "https://cache.nixos.org"
    "https://bloom-os.cachix.org"
  ];
  nix.settings.trusted-public-keys = [
    "cache.nixos.org-1:6NCHdD59X431o0gWypbMrAURkbJ16ZPMQFGspcDShjY="
    "bloom-os.cachix.org-1:<paste-actual-pubkey-from-step-1>"
  ];
  ```

  Replace `<paste-actual-pubkey-from-step-1>` with the real public key from the Cachix dashboard.

- [ ] **Step 3: Verify eval passes**

  ```bash
  nix eval .#nixosConfigurations.bloom-installed-test.config.nix.settings.substituters
  ```

  Expected: a list containing both `"https://cache.nixos.org"` and `"https://bloom-os.cachix.org"`.

- [ ] **Step 4: Add `cachix-action` to `build-os.yml`**

  In `.github/workflows/build-os.yml`, the current step order is:
  1. `actions/checkout`
  2. `DeterminateSystems/nix-installer-action`
  3. `DeterminateSystems/magic-nix-cache-action`
  4. `actions/setup-node`
  5. `npm ci`
  6. TypeScript build, Biome check, tests, coverage upload
  7. `nix eval ...`
  8. `nix build .#bloom-app`

  Insert the `cachix-action` step as step 4 (immediately after `magic-nix-cache-action`, before `setup-node`):

  ```yaml
      - name: Set up Cachix
        uses: cachix/cachix-action@v15
        with:
          name: bloom-os
          authToken: '${{ secrets.CACHIX_AUTH_TOKEN }}'
  ```

  Then add a new `nix build` step after the existing `nix build .#bloom-app` step:

  ```yaml
      - name: Build bloom-config check (populates Cachix)
        run: nix build .#checks.x86_64-linux.bloom-config
  ```

  **Why `cachix-action` comes before builds:** The action sets up Cachix as both a substituter (so builds can pull from cache) and a push target (so all new store paths built during the job are automatically pushed). If placed after builds, it misses all the paths built earlier in the job.

  **What gets cached:** All Nix store paths built during the job, including those from `nix build .#bloom-app` and `nix build .#checks.x86_64-linux.bloom-config`. The `bloom-config` check builds `nixosConfigurations.bloom-installed-test` — the configuration that end users actually install via Calamares.

- [ ] **Step 5: Commit**

  ```bash
  git add core/os/modules/bloom-update.nix .github/workflows/build-os.yml
  git commit -m "feat(cache): add Cachix binary cache for on-device updates

  bloom-update.nix now references the bloom-os Cachix substituter so
  nixos-rebuild pulls pre-built binaries. build-os.yml pushes closures
  to Cachix on every merge to main."
  ```

- [ ] **Step 6: Verify CI pushes to Cachix**

  Push to `main` (or open a PR and merge it). Check the GitHub Actions run for the `Build Bloom OS` workflow. The `Set up Cachix` step should show it's authenticated, and subsequent build steps should show paths being pushed to `bloom-os.cachix.org`.

  In the Cachix dashboard, the `bloom-os` cache should show store paths populated after the workflow completes.

---

## Done

After all four tasks, the system should:
- Have no WiFi PSK in any Nix module
- Have a Sway config managed by NixOS (updated on every `nixos-rebuild switch` for new installs)
- Have a working `nix develop` shell for contributors
- Have Cachix wired up so on-device updates pull from cache instead of compiling from scratch

Final verification:

```bash
# All NixOS checks pass
nix build .#checks.x86_64-linux.bloom-config

# Dev shell works
nix develop --command bash -c "node --version && biome --version && vitest --version && shellcheck --version && just --version"

# No wifi options remain
grep -r "bloom.wifi" core/os/modules/
# Expected: no output
```
