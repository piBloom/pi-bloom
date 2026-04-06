# Bootstrap Rebuild Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the bootstrap flow so miniPC installs land on stable NixOS 25.11 with working display, and users have a correct rebuild command available on first boot.

**Architecture:** Four targeted changes — remove the accidental `nixosConfigurations.nixpi` alias, add a `nixpi-rebuild` wrapper script + Nix package wired into the system, add GPU firmware to the VPS host profile, and print a post-bootstrap success hint. Each change is guarded by a `nix build` check assertion written first (TDD).

**Tech Stack:** Bash, Nix/NixOS module system

---

## File Map

| Status | Path | Purpose |
|---|---|---|
| Create | `core/scripts/nixpi-rebuild.sh` | Wrapper: runs `nixos-rebuild switch --flake /etc/nixos --impure "$@"` |
| Create | `core/os/pkgs/nixpi-rebuild/default.nix` | Nix derivation that installs the wrapper into `$out/bin/nixpi-rebuild` |
| Modify | `flake.nix` | Remove alias (line 122); add `nixpi-rebuild` to `packages`; add check assertions |
| Modify | `core/os/modules/tooling.nix` | Add `nixpi-rebuild` package to `environment.systemPackages` |
| Modify | `core/os/hosts/vps.nix` | Add `hardware.enableRedistributableFirmware = lib.mkDefault true` |
| Modify | `core/os/pkgs/bootstrap/nixpi-bootstrap-vps.sh` | Append success message pointing users to `nixpi-rebuild` |

---

### Task 1: Commit the spec doc

**Files:**
- Commit: `docs/superpowers/specs/2026-04-07-bootstrap-rebuild-fix-design.md`

- [ ] **Step 1: Commit**

```bash
git add docs/superpowers/specs/2026-04-07-bootstrap-rebuild-fix-design.md
git commit -m "docs: add bootstrap rebuild fix design spec"
```

---

### Task 2: Remove `nixosConfigurations.nixpi` alias + guard check

The alias `nixosConfigurations.nixpi = self.nixosConfigurations.vps` on line 122 of `flake.nix` makes `--flake /srv/nixpi#nixpi` resolve, which bypasses the host-owned `/etc/nixos` flake and pulls in `nixos-unstable`. Removing it makes that command fail with an attribute-not-found error.

**Files:**
- Modify: `flake.nix` (vps-topology check block + line 122)

- [ ] **Step 1: Add failing check assertion**

In `flake.nix`, find `vps-topology = pkgs.runCommandLocal "vps-topology-check" { } ''`. Add this line before the closing `touch "$out"`:

```bash
! grep -F 'nixosConfigurations.nixpi = self.nixosConfigurations.vps' ${./flake.nix}
```

- [ ] **Step 2: Run check — confirm it fails**

```bash
nix build .#checks.x86_64-linux.vps-topology 2>&1 | tail -20
```

Expected: build fails because the alias is still present.

- [ ] **Step 3: Remove the alias**

In `flake.nix`, delete this line (currently line 122):

```nix
nixosConfigurations.nixpi = self.nixosConfigurations.vps;
```

- [ ] **Step 4: Run check — confirm it passes**

```bash
nix build .#checks.x86_64-linux.vps-topology 2>&1 | tail -5
```

Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add flake.nix
git commit -m "fix: remove nixosConfigurations.nixpi alias to prevent accidental unstable rebuild"
```

---

### Task 3: Add `nixpi-rebuild` wrapper script and package

**Files:**
- Create: `core/scripts/nixpi-rebuild.sh`
- Create: `core/os/pkgs/nixpi-rebuild/default.nix`
- Modify: `flake.nix` (bootstrap-script check + packages block + let binding)
- Modify: `core/os/modules/tooling.nix`

- [ ] **Step 1: Add failing check assertions to bootstrap-script**

In `flake.nix`, find `bootstrap-script = pkgs.runCommandLocal "bootstrap-script-check" { } ''`. Add these lines before the closing `touch "$out"`:

```bash
test -x "${./core/scripts/nixpi-rebuild.sh}"
grep -F 'nixos-rebuild switch --flake /etc/nixos --impure' "${./core/scripts/nixpi-rebuild.sh}"
grep -F '"$@"' "${./core/scripts/nixpi-rebuild.sh}"
```

- [ ] **Step 2: Run check — confirm it fails**

```bash
nix build .#checks.x86_64-linux.bootstrap-script 2>&1 | tail -20
```

Expected: fails because `core/scripts/nixpi-rebuild.sh` does not exist.

- [ ] **Step 3: Create the script**

Create `core/scripts/nixpi-rebuild.sh` with this exact content:

```bash
#!/usr/bin/env bash
set -euo pipefail
exec nixos-rebuild switch --flake /etc/nixos --impure "$@"
```

Mark it executable:

```bash
chmod +x core/scripts/nixpi-rebuild.sh
```

- [ ] **Step 4: Run check — confirm script assertions pass**

```bash
nix build .#checks.x86_64-linux.bootstrap-script 2>&1 | tail -5
```

Expected: exits 0.

- [ ] **Step 5: Create the Nix package**

Create `core/os/pkgs/nixpi-rebuild/default.nix`:

```nix
{ stdenvNoCC }:

stdenvNoCC.mkDerivation {
  pname = "nixpi-rebuild";
  version = "0.1.0";

  dontUnpack = true;

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/bin"
    install -m 0755 ${../../../scripts/nixpi-rebuild.sh} "$out/bin/nixpi-rebuild"
    runHook postInstall
  '';
}
```

- [ ] **Step 6: Wire into flake.nix**

In `flake.nix`, in the top `let` block where `bootstrapPackage` and `setupApplyPackage` are defined, add:

```nix
nixpiRebuildPackage = pkgs.callPackage ./core/os/pkgs/nixpi-rebuild { };
```

In `packages.${system}`, add:

```nix
nixpi-rebuild = nixpiRebuildPackage;
```

- [ ] **Step 7: Add to tooling.nix**

Replace the entire content of `core/os/modules/tooling.nix` with:

```nix
{ pkgs, lib, config, ... }:
let
  nixpiRebuild = pkgs.callPackage ../pkgs/nixpi-rebuild { };
in
{
  imports = [ ./options.nix ];

  environment.systemPackages = with pkgs; [
    git
    git-lfs
    gh
    nodejs
    ripgrep
    fd
    bat
    htop
    jq
    curl
    wget
    unzip
    openssl
    just
    shellcheck
    biome
    typescript
    qemu
    OVMF
    nixpiRebuild
  ] ++ lib.optionals config.nixpi.security.fail2ban.enable [ pkgs.fail2ban ];
}
```

- [ ] **Step 8: Verify config check passes**

```bash
nix build .#checks.x86_64-linux.config 2>&1 | tail -10
```

Expected: exits 0 — the installed-test system closure builds successfully with the new package included.

- [ ] **Step 9: Commit**

```bash
git add core/scripts/nixpi-rebuild.sh core/os/pkgs/nixpi-rebuild/default.nix flake.nix core/os/modules/tooling.nix
git commit -m "feat: add nixpi-rebuild wrapper to enforce correct flake rebuild target"
```

---

### Task 4: Add GPU firmware to `vps.nix`

`hardware.enableRedistributableFirmware` pulls in Intel and AMD GPU firmware blobs, making KMS initialization reliable on miniPC hardware under newer kernels. `lib.mkDefault` lets consuming configurations override it.

**Files:**
- Modify: `flake.nix` (vps-topology check)
- Modify: `core/os/hosts/vps.nix`

- [ ] **Step 1: Add failing check assertion**

In `flake.nix`, in the `vps-topology` check, add before the closing `touch "$out"`:

```bash
grep -F 'enableRedistributableFirmware' ${./core/os/hosts/vps.nix}
```

- [ ] **Step 2: Run check — confirm it fails**

```bash
nix build .#checks.x86_64-linux.vps-topology 2>&1 | tail -20
```

Expected: fails because `vps.nix` does not yet set `enableRedistributableFirmware`.

- [ ] **Step 3: Add firmware to vps.nix**

In `core/os/hosts/vps.nix`, add after the `console.keyMap = config.nixpi.keyboard;` line and before the `fileSystems."/"` block:

```nix
  # Include redistributable GPU firmware (Intel, AMD) for reliable KMS
  # initialization on monitor-attached hardware such as miniPCs.
  hardware.enableRedistributableFirmware = lib.mkDefault true;
```

- [ ] **Step 4: Run check — confirm it passes**

```bash
nix build .#checks.x86_64-linux.vps-topology 2>&1 | tail -5
```

Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add flake.nix core/os/hosts/vps.nix
git commit -m "fix: enable redistributable GPU firmware in vps profile for miniPC display support"
```

---

### Task 5: Add post-bootstrap success message

**Files:**
- Modify: `core/os/pkgs/bootstrap/nixpi-bootstrap-vps.sh`
- Modify: `flake.nix` (bootstrap-script check)

- [ ] **Step 1: Add failing check assertion**

In `flake.nix`, in the `bootstrap-script` check, add before the closing `touch "$out"`:

```bash
grep -F "Use 'nixpi-rebuild' to rebuild" "${bootstrapScriptSource}"
```

- [ ] **Step 2: Run check — confirm it fails**

```bash
nix build .#checks.x86_64-linux.bootstrap-script 2>&1 | tail -20
```

Expected: fails.

- [ ] **Step 3: Add the message**

In `core/os/pkgs/bootstrap/nixpi-bootstrap-vps.sh`, after the final `run_as_root nixos-rebuild switch ...` line, add:

```bash
log "Bootstrap complete. Use 'nixpi-rebuild' to rebuild or update your system."
```

- [ ] **Step 4: Run check — confirm it passes**

```bash
nix build .#checks.x86_64-linux.bootstrap-script 2>&1 | tail -5
```

Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add core/os/pkgs/bootstrap/nixpi-bootstrap-vps.sh flake.nix
git commit -m "fix: print nixpi-rebuild hint after bootstrap completes"
```

---

### Task 6: Final validation and lat check

- [ ] **Step 1: Run all affected checks together**

```bash
nix build \
  .#checks.x86_64-linux.bootstrap-script \
  .#checks.x86_64-linux.host-flake-bootstrap \
  .#checks.x86_64-linux.vps-topology \
  .#checks.x86_64-linux.config \
  2>&1 | tail -20
```

Expected: all four succeed (exits 0, no error output).

- [ ] **Step 2: Run lat check**

```bash
lat check
```

If any lat.md sections are flagged as out of sync, run `lat section <section-name>` to read the relevant section, update it to reflect the code changes (new `nixpi-rebuild` script, firmware addition, alias removal), then re-run `lat check` until it passes.

- [ ] **Step 3: Commit lat.md updates (if any)**

```bash
git add lat.md/
git commit -m "docs: sync lat.md with bootstrap rebuild fix changes"
```

- [ ] **Step 4: Confirm final git log**

```bash
git log --oneline -6
```

Expected (in order, newest first):
```
<hash> docs: sync lat.md with bootstrap rebuild fix changes  # only if lat check found changes
<hash> fix: print nixpi-rebuild hint after bootstrap completes
<hash> fix: enable redistributable GPU firmware in vps profile for miniPC display support
<hash> feat: add nixpi-rebuild wrapper to enforce correct flake rebuild target
<hash> fix: remove nixosConfigurations.nixpi alias to prevent accidental unstable rebuild
<hash> docs: add bootstrap rebuild fix design spec
```
