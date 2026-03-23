# NixOS Test Suite Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate all 15 NixOS VM tests from the custom `mkTest` wrapper pattern to the upstream `runTest` module pattern, and add two new tests: `nixpi-update` (deep integration) and `nixpi-options-validation`.

**Architecture:** The test loader (`tests/nixos/default.nix`) is updated to call `pkgs.testers.runNixOSTest { imports = [testFile]; _module.args = sharedArgs; }` instead of the old `mkTest` wrapper. Individual test files become plain NixOS modules (no `pkgs.testers.runNixOSTest` call inside them). Two new test files are added. Check lanes in `flake.nix` are expanded.

**Tech Stack:** Nix/NixOS module system, `pkgs.testers.runNixOSTest`, NixOS VM test framework (Python test driver), systemd, nix CLI.

**Spec:** `docs/superpowers/specs/2026-03-23-nixos-test-suite-enhancement-design.md`

---

## File Map

| Action | File | What changes |
|--------|------|------|
| Modify | `tests/nixos/default.nix` | Replace `mkTest`/`mkInstallerTest` with `runTest`/`runInstallerTest`; add two new test entries; `lib.nix` unchanged |
| Modify | `tests/nixos/nixpi-matrix.nix` | Remove outer fn+wrapper; become module |
| Modify | `tests/nixos/nixpi-firstboot.nix` | Same |
| Modify | `tests/nixos/nixpi-network.nix` | Same |
| Modify | `tests/nixos/nixpi-daemon.nix` | Same |
| Modify | `tests/nixos/nixpi-e2e.nix` | Same |
| Modify | `tests/nixos/nixpi-home.nix` | Same |
| Modify | `tests/nixos/nixpi-desktop.nix` | Same |
| Modify | `tests/nixos/nixpi-security.nix` | Same |
| Modify | `tests/nixos/nixpi-modular-services.nix` | Same |
| Modify | `tests/nixos/nixpi-matrix-bridge.nix` | Same |
| Modify | `tests/nixos/nixpi-matrix-reply.nix` | Same |
| Modify | `tests/nixos/nixpi-bootstrap-mode.nix` | Same |
| Modify | `tests/nixos/nixpi-post-setup-lockdown.nix` | Same |
| Modify | `tests/nixos/nixpi-broker.nix` | Same |
| Modify | `tests/nixos/nixpi-installer-smoke.nix` | Same; keep `node.pkgsReadOnly = false` |
| Create | `tests/nixos/nixpi-options-validation.nix` | New VM test for option defaults/overrides |
| Create | `tests/nixos/nixpi-update.nix` | New deep integration test for OTA update flow |
| Modify | `flake.nix` | Add new tests to nixos-full; add installer-smoke to nixos-smoke |

---

## Task 1: Migrate `default.nix` to `runTest` pattern

**Files:**
- Modify: `tests/nixos/default.nix`

The migration rule: replace the `mkTest`/`mkInstallerTest` wrapper functions with `runTest`/`runInstallerTest`. The key difference is that `runTest` calls `pkgs.testers.runNixOSTest { imports = [testFile]; _module.args = sharedArgs; }` rather than importing the test file as a function and passing explicit args into it.

- [ ] **Step 1: Read the current `default.nix`**

  Read `tests/nixos/default.nix` in full before editing. Understand the current `mkTest`/`mkInstallerTest` shape.

- [ ] **Step 2: Replace the loader with the new `runTest` pattern**

  Replace the entire `let ... in` block at the top of `tests/nixos/default.nix` with:

  ```nix
  { pkgs, lib, piAgent, appPackage, self, installerHelper ? null, setupPackage }:

  let
    testLib = import ./lib.nix { inherit pkgs lib self; };

    # self is forwarded independently (not from testLib) so test node modules
    # can reference self.nixosModules.* via _module.args.
    sharedArgs = {
      inherit piAgent appPackage setupPackage self;
      inherit (testLib)
        nixPiModules
        nixPiModulesNoShell
        mkTestFilesystems
        mkMatrixAdminSeedConfig
        matrixTestClient
        matrixRegisterScript
        mkManagedUserConfig
        mkPrefillActivation;
    };

    runTest = testFile: pkgs.testers.runNixOSTest {
      imports = [ testFile ];
      _module.args = sharedArgs;
    };

    runInstallerTest = testFile: pkgs.testers.runNixOSTest {
      imports = [ testFile ];
      _module.args = sharedArgs // { inherit installerHelper; };
    };

    tests = {
      nixpi-matrix               = runTest ./nixpi-matrix.nix;
      nixpi-firstboot            = runTest ./nixpi-firstboot.nix;
      nixpi-network              = runTest ./nixpi-network.nix;
      nixpi-daemon               = runTest ./nixpi-daemon.nix;
      nixpi-e2e                  = runTest ./nixpi-e2e.nix;
      nixpi-home                 = runTest ./nixpi-home.nix;
      nixpi-desktop              = runTest ./nixpi-desktop.nix;
      nixpi-security             = runTest ./nixpi-security.nix;
      nixpi-modular-services     = runTest ./nixpi-modular-services.nix;
      nixpi-matrix-bridge        = runTest ./nixpi-matrix-bridge.nix;
      nixpi-matrix-reply         = runTest ./nixpi-matrix-reply.nix;
      nixpi-bootstrap-mode       = runTest ./nixpi-bootstrap-mode.nix;
      nixpi-post-setup-lockdown  = runTest ./nixpi-post-setup-lockdown.nix;
      nixpi-broker               = runTest ./nixpi-broker.nix;
      nixpi-installer-smoke      = runInstallerTest ./nixpi-installer-smoke.nix;
      nixpi-update               = runTest ./nixpi-update.nix;
      nixpi-options-validation   = runTest ./nixpi-options-validation.nix;
    };

    smokeAliases = {
      smoke-matrix    = tests.nixpi-matrix;
      smoke-firstboot = tests.nixpi-firstboot;
      smoke-security  = tests.nixpi-security;
      smoke-broker    = tests.nixpi-broker;
      smoke-desktop   = tests.nixpi-desktop;
      installer-smoke = tests.nixpi-installer-smoke;
    };
  in
  tests // smokeAliases
  ```

  The `nixpi-update` and `nixpi-options-validation` entries reference files that don't exist yet — that's fine, Nix evaluates lazily and won't fail until you actually build those derivations.

- [ ] **Step 3: Verify the file parses**

  ```bash
  nix eval --file tests/nixos/default.nix --apply 'x: builtins.attrNames x' \
    --arg pkgs 'import <nixpkgs> {}' \
    --arg lib '(import <nixpkgs> {}).lib' \
    --arg piAgent 'null' \
    --arg appPackage 'null' \
    --arg setupPackage 'null' \
    --arg self '{}' 2>&1 | head -20
  ```

  Expected: either a list of test names (success) or an error only about the missing test files (`nixpi-update.nix`, `nixpi-options-validation.nix`) — not about missing functions or wrong argument types.

  > Note: Full evaluation of each test requires the real `self` and packages — this quick check only verifies the file parses and the attrset structure is correct.

- [ ] **Step 4: Commit**

  ```bash
  git add tests/nixos/default.nix
  git commit -m "refactor(tests): migrate test loader to runTest module pattern"
  ```

---

## Task 2: Migrate test files — batch 1 (simple args, no special cases)

**Files:**
- Modify: `tests/nixos/nixpi-matrix.nix`, `tests/nixos/nixpi-firstboot.nix`, `tests/nixos/nixpi-network.nix`, `tests/nixos/nixpi-home.nix`, `tests/nixos/nixpi-desktop.nix`, `tests/nixos/nixpi-modular-services.nix`, `tests/nixos/nixpi-broker.nix`

The mechanical transformation for each file:

1. Change the outer function signature — remove `pkgs` (and any other helpers now injected by `sharedArgs`); keep only what's actually used in the file body. If the file only used `pkgs` to call `runNixOSTest`, it can be removed entirely.
2. Remove the `pkgs.testers.runNixOSTest {` wrapper line and its closing `}`.
3. The remaining attrset (`name`, `nodes`, `testScript`) becomes the file's return value directly.

**Example — `nixpi-matrix.nix`:**

Before (first and last lines):
```nix
{ pkgs, lib, nixPiModules, nixPiModulesNoShell, piAgent, appPackage, setupPackage, mkTestFilesystems, ... }:
pkgs.testers.runNixOSTest {
  name = "nixpi-matrix";
  ...
}
```

After:
```nix
{ lib, nixPiModules, piAgent, appPackage, setupPackage, mkTestFilesystems, ... }:
{
  name = "nixpi-matrix";
  ...
}
```

- [ ] **Step 1: Read each file** — read all 7 files before editing to confirm none have unexpected patterns (e.g., using `pkgs` at the outer level for something other than `runNixOSTest`).

  Files: `nixpi-matrix.nix`, `nixpi-firstboot.nix`, `nixpi-network.nix`, `nixpi-home.nix`, `nixpi-desktop.nix`, `nixpi-modular-services.nix`, `nixpi-broker.nix`

- [ ] **Step 2: Apply the transformation to each file**

  For each file:
  - Remove `pkgs` from the outer function args (retain `lib` if used, retain all others that appear in the body)
  - Remove `pkgs.testers.runNixOSTest {` on the second line
  - Remove the matching closing `}` at the end of the file
  - The inner attrset is now the top-level return

  **Critical:** `pkgs` inside `nodes.*` closures is provided by the NixOS module system — do not remove those.

- [ ] **Step 3: Verify each file parses**

  ```bash
  for f in nixpi-matrix nixpi-firstboot nixpi-network nixpi-home nixpi-desktop nixpi-modular-services nixpi-broker; do
    echo "=== $f ==="
    nix eval --file "tests/nixos/${f}.nix" --apply 'x: x.name' \
      --arg lib '(import <nixpkgs> {}).lib' \
      --arg piAgent 'null' --arg appPackage 'null' --arg setupPackage 'null' \
      --arg nixPiModules '[]' --arg nixPiModulesNoShell '[]' \
      --arg mkTestFilesystems '{}' --arg mkMatrixAdminSeedConfig 'x: {}' \
      --arg matrixTestClient 'null' --arg matrixRegisterScript '""' \
      --arg mkManagedUserConfig 'x: {}' --arg mkPrefillActivation 'x: ""' \
      --arg self '{}' 2>&1
  done
  ```

  Expected: each prints the test name string (e.g., `"nixpi-matrix"`) or at most a deep evaluation error about `nixPiModules` contents — not a parse error or "argument not provided" error at the outer function level.

- [ ] **Step 4: Commit**

  ```bash
  git add tests/nixos/nixpi-matrix.nix tests/nixos/nixpi-firstboot.nix \
    tests/nixos/nixpi-network.nix tests/nixos/nixpi-home.nix \
    tests/nixos/nixpi-desktop.nix tests/nixos/nixpi-modular-services.nix \
    tests/nixos/nixpi-broker.nix
  git commit -m "refactor(tests): migrate batch-1 test files to runTest module pattern"
  ```

---

## Task 3: Migrate test files — batch 2 (matrix helpers, multi-node)

**Files:**
- Modify: `tests/nixos/nixpi-daemon.nix`, `tests/nixos/nixpi-e2e.nix`, `tests/nixos/nixpi-matrix-bridge.nix`, `tests/nixos/nixpi-matrix-reply.nix`, `tests/nixos/nixpi-bootstrap-mode.nix`, `tests/nixos/nixpi-post-setup-lockdown.nix`, `tests/nixos/nixpi-security.nix`

Same mechanical transformation as Task 2. These are batched separately because they use Matrix helpers (`matrixTestClient`, `matrixRegisterScript`, `mkMatrixAdminSeedConfig`, `mkManagedUserConfig`, `mkPrefillActivation`) and/or have multi-node setups — worth a careful read before editing.

- [ ] **Step 1: Read all 7 files** — confirm the outer `pkgs` usage is only for `runNixOSTest`. Note any `pkgs.*` at the outer scope (not inside a `nodes.*` closure) that would need to be handled differently.

- [ ] **Step 2: Apply the transformation to each file** — same rules as Task 2.

- [ ] **Step 3: Verify each file parses**

  ```bash
  for f in nixpi-daemon nixpi-e2e nixpi-matrix-bridge nixpi-matrix-reply nixpi-bootstrap-mode nixpi-post-setup-lockdown nixpi-security; do
    echo "=== $f ==="
    nix eval --file "tests/nixos/${f}.nix" --apply 'x: x.name' \
      --arg lib '(import <nixpkgs> {}).lib' \
      --arg piAgent 'null' --arg appPackage 'null' --arg setupPackage 'null' \
      --arg nixPiModules '[]' --arg nixPiModulesNoShell '[]' \
      --arg mkTestFilesystems '{}' --arg mkMatrixAdminSeedConfig 'x: {}' \
      --arg matrixTestClient 'null' --arg matrixRegisterScript '""' \
      --arg mkManagedUserConfig 'x: {}' --arg mkPrefillActivation 'x: ""' \
      --arg self '{}' 2>&1
  done
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add tests/nixos/nixpi-daemon.nix tests/nixos/nixpi-e2e.nix \
    tests/nixos/nixpi-matrix-bridge.nix tests/nixos/nixpi-matrix-reply.nix \
    tests/nixos/nixpi-bootstrap-mode.nix tests/nixos/nixpi-post-setup-lockdown.nix \
    tests/nixos/nixpi-security.nix
  git commit -m "refactor(tests): migrate batch-2 test files to runTest module pattern"
  ```

---

## Task 4: Migrate `nixpi-installer-smoke.nix`

**Files:**
- Modify: `tests/nixos/nixpi-installer-smoke.nix`

This file has two special features:
1. `node.pkgsReadOnly = false` — must be retained (it's a test option)
2. References to `${pkgs.path}/...` and `${pkgs.qemu}/...` inside the `nodes` block — these come from the NixOS module system's `pkgs` special arg after migration, not from the outer function. No change needed to those references.

- [ ] **Step 1: Read `nixpi-installer-smoke.nix` in full**

- [ ] **Step 2: Apply the transformation**

  - Remove `pkgs` from the outer function args (keep `installerHelper`, `self`, `lib`, and any other args actually used at the outer scope)
  - Remove the `pkgs.testers.runNixOSTest {` wrapper and closing `}`
  - Retain `node.pkgsReadOnly = false;` as-is inside the test attrset

- [ ] **Step 3: Verify the file parses**

  ```bash
  nix eval --file tests/nixos/nixpi-installer-smoke.nix --apply 'x: x.name' \
    --arg lib '(import <nixpkgs> {}).lib' \
    --arg installerHelper 'null' \
    --arg piAgent 'null' --arg appPackage 'null' --arg setupPackage 'null' \
    --arg nixPiModules '[]' --arg nixPiModulesNoShell '[]' \
    --arg mkTestFilesystems '{}' --arg self '{}' \
    --arg mkMatrixAdminSeedConfig 'x: {}' --arg matrixTestClient 'null' \
    --arg matrixRegisterScript '""' --arg mkManagedUserConfig 'x: {}' \
    --arg mkPrefillActivation 'x: ""' 2>&1
  ```

  Expected: `"nixpi-installer-smoke"`

- [ ] **Step 4: Commit**

  ```bash
  git add tests/nixos/nixpi-installer-smoke.nix
  git commit -m "refactor(tests): migrate nixpi-installer-smoke to runTest module pattern"
  ```

---

## Task 5: Smoke check — verify existing tests still evaluate

**Files:** None modified — read-only verification.

This step verifies the full migration against the real flake before adding any new tests.

- [ ] **Step 1: Evaluate the smoke lane**

  ```bash
  nix build .#checks.x86_64-linux.nixos-smoke --dry-run 2>&1 | head -40
  ```

  Expected: Nix prints the derivations it would build — no evaluation errors. The `nixos-smoke` lane references `nixpi-update` and `nixpi-options-validation` indirectly via `nixos-full`, but not directly, so the missing files won't block this check.

  > If you see "file 'tests/nixos/nixpi-update.nix' does not exist" here, that means `default.nix` has already registered those tests and the smoke lane is pulling them in transitively. In that case, create placeholder files first:
  > ```bash
  > echo '{ ... }: { name = "nixpi-update"; nodes = {}; testScript = ""; }' > tests/nixos/nixpi-update.nix
  > echo '{ ... }: { name = "nixpi-options-validation"; nodes = {}; testScript = ""; }' > tests/nixos/nixpi-options-validation.nix
  > ```
  > Then re-run the dry-run. Replace these placeholders in Tasks 6 and 7.

- [ ] **Step 2: Build the static config check (fast, no VM)**

  ```bash
  nix build .#checks.x86_64-linux.config --dry-run 2>&1 | head -20
  ```

  Expected: no evaluation errors.

---

## Task 6: Add `nixpi-options-validation.nix`

**Files:**
- Create: `tests/nixos/nixpi-options-validation.nix`

This test boots two nodes — one with default options, one with overrides — and checks that module options produce the correct runtime state. It does not test update logic or the Matrix bridge; it only checks: default user, port bindings, broker autonomy, fail2ban, SSH.

Both nodes use `nixPiModules ++ [ mkTestFilesystems ]` (full NixPI stack including shell) and `mkManagedUserConfig`.

- [ ] **Step 1: Create `tests/nixos/nixpi-options-validation.nix`**

  ```nix
  { lib, nixPiModules, mkTestFilesystems, mkManagedUserConfig, piAgent, appPackage, setupPackage, ... }:

  {
    name = "nixpi-options-validation";

    nodes = {
      # Node A: all defaults, primaryUser = "pi"
      defaults = { ... }: {
        imports = nixPiModules ++ [ mkTestFilesystems (mkManagedUserConfig { username = "pi"; }) ];
        _module.args = { inherit piAgent appPackage setupPackage; };
        networking.hostName = "nixpi-defaults-test";
        time.timeZone = "UTC";
        i18n.defaultLocale = "en_US.UTF-8";
        networking.networkmanager.enable = true;
        system.stateVersion = "25.05";
        boot.loader.systemd-boot.enable = true;
        boot.loader.efi.canTouchEfiVariables = true;
        virtualisation.diskSize = 20480;
        virtualisation.memorySize = 4096;
      };

      # Node B: overridden ports and security settings
      overrides = { ... }: {
        imports = nixPiModules ++ [ mkTestFilesystems (mkManagedUserConfig { username = "pi"; }) ];
        _module.args = { inherit piAgent appPackage setupPackage; };
        networking.hostName = "nixpi-overrides-test";
        time.timeZone = "UTC";
        i18n.defaultLocale = "en_US.UTF-8";
        networking.networkmanager.enable = true;
        system.stateVersion = "25.05";
        boot.loader.systemd-boot.enable = true;
        boot.loader.efi.canTouchEfiVariables = true;
        virtualisation.diskSize = 20480;
        virtualisation.memorySize = 4096;

        nixpi.matrix.port = 7777;
        nixpi.services.home.port = 9090;
        nixpi.security.fail2ban.enable = false;
        nixpi.security.ssh.passwordAuthentication = true;
      };
    };

    testScript = ''
      # --- Node A: defaults ---
      defaults.start()
      defaults.wait_for_unit("multi-user.target", timeout=300)

      # Default primary user exists
      defaults.succeed("id pi")

      # Matrix on default port 6167
      defaults.wait_for_unit("continuwuity.service", timeout=60)
      defaults.succeed("curl -sf http://localhost:6167/_matrix/client/versions")

      # NixPI Home on default port 8080
      defaults.wait_for_unit("nixpi-home.service", timeout=60)
      defaults.succeed("curl -sf http://localhost:8080/")

      # Element Web on default port 8081
      defaults.wait_for_unit("nixpi-element-web.service", timeout=60)
      defaults.succeed("curl -sf http://localhost:8081/")

      # Broker config contains default "maintain" autonomy
      broker_cfg = defaults.succeed(
          "systemctl show nixpi-broker.service -p Environment --value"
          " | grep -oP 'NIXPI_BROKER_CONFIG=\\K\\S+'"
      ).strip()
      defaults.succeed(f"grep -q maintain {broker_cfg}")

      # fail2ban active by default
      defaults.succeed("systemctl is-active fail2ban")

      # SSH password auth disabled by default
      defaults.succeed("sshd -T | grep -i 'passwordauthentication no'")

      # --- Node B: overrides ---
      overrides.start()
      overrides.wait_for_unit("multi-user.target", timeout=300)

      # Matrix on overridden port 7777, not 6167
      overrides.wait_for_unit("continuwuity.service", timeout=60)
      overrides.succeed("curl -sf http://localhost:7777/_matrix/client/versions")
      overrides.fail("curl -sf http://localhost:6167/_matrix/client/versions")

      # NixPI Home on overridden port 9090
      overrides.wait_for_unit("nixpi-home.service", timeout=60)
      overrides.succeed("curl -sf http://localhost:9090/")

      # fail2ban disabled
      overrides.fail("systemctl is-active fail2ban")

      # SSH password auth enabled
      overrides.succeed("sshd -T | grep -i 'passwordauthentication yes'")

      print("All nixpi-options-validation tests passed!")
    '';
  }
  ```

- [ ] **Step 2: Verify the file parses**

  ```bash
  nix eval --file tests/nixos/nixpi-options-validation.nix --apply 'x: x.name' \
    --arg lib '(import <nixpkgs> {}).lib' \
    --arg piAgent 'null' --arg appPackage 'null' --arg setupPackage 'null' \
    --arg nixPiModules '[]' --arg mkTestFilesystems '{}' \
    --arg mkManagedUserConfig 'x: {}' \
    --arg matrixTestClient 'null' --arg matrixRegisterScript '""' \
    --arg nixPiModulesNoShell '[]' --arg mkMatrixAdminSeedConfig 'x: {}' \
    --arg mkPrefillActivation 'x: ""' --arg self '{}' 2>&1
  ```

  Expected: `"nixpi-options-validation"`

- [ ] **Step 3: Commit**

  ```bash
  git add tests/nixos/nixpi-options-validation.nix
  git commit -m "test: add nixpi-options-validation NixOS test"
  ```

---

## Task 7: Add `nixpi-update.nix`

**Files:**
- Create: `tests/nixos/nixpi-update.nix`

This is the most complex test. Read this task in full before starting.

**How the custom update command works:**
- The real `system-update.sh` calls `nix build <flake>#...` which requires network/impure evaluation in a sandbox.
- Instead, the test node overrides `nixpi-update.command` to a custom shell script that reads the "new system" path from a file (`/run/nixpi-update-test/next-system`) written by the test driver, compares it to `/run/current-system`, and conditionally activates the new system.
- Both candidate system closures (`systemSame` and `systemNew`) are pre-built at Nix eval time and injected via `virtualisation.additionalPaths` so they're already in the VM's Nix store.

**How `nixpi-update.command` is overridden:**
The `update.nix` module sets `system.services.nixpi-update.nixpi-update.command` to the `nixpi-update` shell script. In the test node, we override `nixpi-update.command` via the `system.services` module option using `lib.mkForce` to replace it with our test script.

- [ ] **Step 1: Read the current `update.nix` module and `nixpi-update.nix` service**

  Read `core/os/modules/update.nix` and `core/os/services/nixpi-update.nix` to understand the exact module option path to override.

- [ ] **Step 2: Create `tests/nixos/nixpi-update.nix`**

  ```nix
  { pkgs, lib, nixPiModulesNoShell, mkTestFilesystems, piAgent, appPackage, setupPackage, ... }:

  let
    # The test node's system config — used to derive systemSame.
    # This must match the node config below exactly (same modules, same options).
    nodeSystemConfig = nixpkgs: nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      specialArgs = { inherit piAgent appPackage setupPackage; };
      modules = nixPiModulesNoShell ++ [
        mkTestFilesystems
        {
          nixpi.primaryUser = "tester";
          networking.hostName = "nixpi-update-test";
          time.timeZone = "UTC";
          i18n.defaultLocale = "en_US.UTF-8";
          networking.networkmanager.enable = true;
          system.stateVersion = "25.05";
          boot.loader.systemd-boot.enable = true;
          boot.loader.efi.canTouchEfiVariables = true;
          users.users.tester = { isNormalUser = true; group = "tester"; initialPassword = "test"; };
          users.groups.tester = {};
        }
      ];
    };

    # systemNew: same base but adds pkgs.hello — a trivially different closure.
    nodeSystemNewConfig = nixpkgs: nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      specialArgs = { inherit piAgent appPackage setupPackage; };
      modules = nixPiModulesNoShell ++ [
        mkTestFilesystems
        {
          nixpi.primaryUser = "tester";
          networking.hostName = "nixpi-update-test";
          time.timeZone = "UTC";
          i18n.defaultLocale = "en_US.UTF-8";
          networking.networkmanager.enable = true;
          system.stateVersion = "25.05";
          boot.loader.systemd-boot.enable = true;
          boot.loader.efi.canTouchEfiVariables = true;
          users.users.tester = { isNormalUser = true; group = "tester"; initialPassword = "test"; };
          users.groups.tester = {};
          environment.systemPackages = [ pkgs.hello ];
        }
      ];
    };

    # Custom update command for the test — reads next-system from a file
    # written by the test driver, bypassing nix build / flake evaluation.
    testUpdateScript = pkgs.writeShellScript "nixpi-update-test-cmd" ''
      set -euo pipefail

      NIXPI_PRIMARY_USER="''${NIXPI_PRIMARY_USER:-tester}"
      NIXPI_PRIMARY_HOME="/home/''${NIXPI_PRIMARY_USER}"
      STATUS_DIR="''${NIXPI_PRIMARY_HOME}/.nixpi"
      STATUS_FILE="''${STATUS_DIR}/update-status.json"
      NEXT_SYSTEM_FILE="/run/nixpi-update-test/next-system"
      CHECKED=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

      mkdir -p "''${STATUS_DIR}"
      chown "''${NIXPI_PRIMARY_USER}" "''${STATUS_DIR}" 2>/dev/null || true

      CURRENT_SYSTEM=$(readlink /run/current-system)
      NEW_SYSTEM=$(cat "''${NEXT_SYSTEM_FILE}" 2>/dev/null || echo "")

      CURRENT_GEN=$(nix-env --list-generations -p /nix/var/nix/profiles/system 2>/dev/null \
        | grep current | awk '{print $1}' || echo "0")

      if [ -z "''${NEW_SYSTEM}" ] || [ "''${NEW_SYSTEM}" = "''${CURRENT_SYSTEM}" ]; then
        AVAILABLE=false
      else
        AVAILABLE=true
      fi

      jq -n \
        --arg checked "''${CHECKED}" \
        --argjson available "''${AVAILABLE}" \
        --arg generation "''${CURRENT_GEN}" \
        --argjson notified false \
        '{"checked": $checked, "available": $available, "generation": $generation, "notified": $notified}' \
        > "''${STATUS_FILE}"
      chown "''${NIXPI_PRIMARY_USER}" "''${STATUS_FILE}"

      if [ "''${AVAILABLE}" = "true" ]; then
        nix-env -p /nix/var/nix/profiles/system --set "''${NEW_SYSTEM}"
        "''${NEW_SYSTEM}/bin/switch-to-configuration" switch
        NEW_GEN=$(nix-env --list-generations -p /nix/var/nix/profiles/system 2>/dev/null \
          | grep current | awk '{print $1}' || echo "0")
        jq -n \
          --arg checked "''${CHECKED}" \
          --arg generation "''${NEW_GEN}" \
          '{"checked": $checked, "available": false, "generation": $generation, "notified": false}' \
          > "''${STATUS_FILE}"
        chown "''${NIXPI_PRIMARY_USER}" "''${STATUS_FILE}"
      fi
    '';
  in
  {
    name = "nixpi-update";

    nodes.machine = { config, pkgs, ... }@nodeArgs:
      let
        systemSame = (nodeSystemConfig pkgs.path).config.system.build.toplevel;
        systemNew  = (nodeSystemNewConfig pkgs.path).config.system.build.toplevel;
      in
      {
        imports = nixPiModulesNoShell ++ [ mkTestFilesystems ];
        _module.args = { inherit piAgent appPackage setupPackage; };
        nixpi.primaryUser = "tester";
        networking.hostName = "nixpi-update-test";
        time.timeZone = "UTC";
        i18n.defaultLocale = "en_US.UTF-8";
        networking.networkmanager.enable = true;
        system.stateVersion = "25.05";
        boot.loader.systemd-boot.enable = true;
        boot.loader.efi.canTouchEfiVariables = true;
        virtualisation.diskSize = 20480;
        virtualisation.memorySize = 4096;
        virtualisation.additionalPaths = [ systemSame systemNew ];

        users.users.tester = {
          isNormalUser = true;
          group = "tester";
          initialPassword = "test";
        };
        users.groups.tester = {};

        # Suppress auto-timer — test triggers the service manually.
        systemd.timers.nixpi-update.timerConfig.OnBootSec = lib.mkForce "999d";

        # Override the update command with the test script.
        system.services.nixpi-update.nixpi-update.command = lib.mkForce testUpdateScript;

        # The ConditionPathExists guard requires /etc/nixos/flake.nix to exist.
        # The test script writes it; ensure the directory exists at boot.
        systemd.tmpfiles.rules = [ "d /etc/nixos 0755 root root -" "d /run/nixpi-update-test 0755 root root -" ];
      };

    testScript = ''
      import json

      machine.start()
      machine.wait_for_unit("multi-user.target", timeout=300)

      # The node config defines two closures by Nix eval.
      # Their store paths must be passed into the Python test as variables.
      # We read them from the additionalPaths derivation outputs at eval time.
      # In practice: we write them into the flake stub below.
      #
      # Phase 0: write the stub flake and the "same" system path.
      machine.succeed("echo 'placeholder' > /etc/nixos/flake.nix")
      machine.succeed("test -f /etc/nixos/flake.nix")

      # Write systemSame path (identical to current system) into next-system.
      current = machine.succeed("readlink /run/current-system").strip()
      machine.succeed(f"echo {current} > /run/nixpi-update-test/next-system")

      # Phase 1: no-op update (new system == current system).
      gen_before = int(machine.succeed(
          "nix-env --list-generations -p /nix/var/nix/profiles/system | wc -l"
      ).strip())
      machine.succeed("systemctl start nixpi-update.service")
      machine.wait_for_unit("nixpi-update.service")

      status = json.loads(machine.succeed("cat /home/tester/.nixpi/update-status.json"))
      assert status["available"] == False, f"Phase 1: expected available=false, got {status}"

      gen_after = int(machine.succeed(
          "nix-env --list-generations -p /nix/var/nix/profiles/system | wc -l"
      ).strip())
      assert gen_after == gen_before, f"Phase 1: generation count changed ({gen_before} -> {gen_after})"

      # Phase 2: real update (new system != current system).
      # systemNew was pre-seeded via virtualisation.additionalPaths.
      # We derive its store path by looking for the hello package in additionalPaths.
      # The simplest way: nix path-info finds it in the store.
      new_system = machine.succeed(
          "nix path-info /nix/store/*nixpi-update-test-new* 2>/dev/null || true"
      ).strip()
      # Fallback: find a path that contains hello (systemNew has pkgs.hello)
      if not new_system:
          new_system = machine.succeed(
              "find /nix/store -maxdepth 1 -name '*-nixos-system-nixpi-update-test*' "
              "| xargs -I{} sh -c 'test -e {}/sw/bin/hello && echo {}' 2>/dev/null | head -1"
          ).strip()
      assert new_system, "Could not locate systemNew in the Nix store"

      machine.succeed(f"echo {new_system} > /run/nixpi-update-test/next-system")

      gen_before = int(machine.succeed(
          "nix-env --list-generations -p /nix/var/nix/profiles/system | wc -l"
      ).strip())
      machine.succeed("systemctl start nixpi-update.service")
      machine.wait_for_unit("nixpi-update.service")

      status = json.loads(machine.succeed("cat /home/tester/.nixpi/update-status.json"))
      assert status["available"] == False, f"Phase 2: expected available=false post-apply, got {status}"

      gen_after = int(machine.succeed(
          "nix-env --list-generations -p /nix/var/nix/profiles/system | wc -l"
      ).strip())
      assert gen_after == gen_before + 1, f"Phase 2: expected generation +1 ({gen_before} -> {gen_after})"

      print("All nixpi-update tests passed!")
    '';
  }
  ```

  > **Implementation note:** The `nodeSystemConfig`/`nodeSystemNewConfig` functions reference `pkgs.path` which is the nixpkgs source path. The `nixPiModulesNoShell` list is a list of NixOS modules — it works as an `imports` list but also as `modules` for `nixosSystem`. If `nixPiModulesNoShell` contains modules that require `specialArgs` (like `piAgent`, `appPackage`), pass them via `specialArgs` to `nixosSystem` as shown.

- [ ] **Step 3: Verify the file parses**

  ```bash
  nix eval --file tests/nixos/nixpi-update.nix --apply 'x: x.name' \
    --arg lib '(import <nixpkgs> {}).lib' \
    --arg pkgs 'import <nixpkgs> {}' \
    --arg piAgent 'null' --arg appPackage 'null' --arg setupPackage 'null' \
    --arg nixPiModulesNoShell '[]' --arg mkTestFilesystems '{}' \
    --arg nixPiModules '[]' --arg mkMatrixAdminSeedConfig 'x: {}' \
    --arg matrixTestClient 'null' --arg matrixRegisterScript '""' \
    --arg mkManagedUserConfig 'x: {}' --arg mkPrefillActivation 'x: ""' \
    --arg self '{}' 2>&1
  ```

  Expected: `"nixpi-update"` or an error only about the inner `nixosSystem` evaluation (acceptable at this stage — the outer file structure is correct).

- [ ] **Step 4: Commit**

  ```bash
  git add tests/nixos/nixpi-update.nix
  git commit -m "test: add nixpi-update deep integration test"
  ```

---

## Task 8: Update `flake.nix` check lanes

**Files:**
- Modify: `flake.nix`

Two changes:
1. Add `installer-smoke` to `nixos-smoke` lane
2. Add `nixpi-update` and `nixpi-options-validation` to `nixos-full` lane

- [ ] **Step 1: Read the relevant section of `flake.nix`**

  Read lines 310–342 of `flake.nix` (the `nixos-smoke`, `nixos-full`, `nixos-destructive` blocks).

- [ ] **Step 2: Update `nixos-smoke` in `flake.nix`**

  Find:
  ```nix
  nixos-smoke = mkCheckLane "nixos-smoke" [
    { name = "smoke-matrix"; path = nixosTests.smoke-matrix; }
    { name = "smoke-firstboot"; path = nixosTests.smoke-firstboot; }
    { name = "smoke-security"; path = nixosTests.smoke-security; }
    { name = "smoke-broker"; path = nixosTests.smoke-broker; }
    { name = "smoke-desktop"; path = nixosTests.smoke-desktop; }
  ];
  ```

  Replace with:
  ```nix
  nixos-smoke = mkCheckLane "nixos-smoke" [
    { name = "smoke-matrix";    path = nixosTests.smoke-matrix; }
    { name = "smoke-firstboot"; path = nixosTests.smoke-firstboot; }
    { name = "smoke-security";  path = nixosTests.smoke-security; }
    { name = "smoke-broker";    path = nixosTests.smoke-broker; }
    { name = "smoke-desktop";   path = nixosTests.smoke-desktop; }
    { name = "installer-smoke"; path = nixosTests.installer-smoke; }
  ];
  ```

- [ ] **Step 3: Update `nixos-full` in `flake.nix`**

  Find the closing bracket of the `nixos-full` `mkCheckLane` list and add two entries before it:
  ```nix
  { name = "nixpi-update";             path = nixosTests.nixpi-update; }
  { name = "nixpi-options-validation"; path = nixosTests.nixpi-options-validation; }
  ```

- [ ] **Step 4: Verify `flake.nix` evaluates**

  ```bash
  nix flake show 2>&1 | grep -E "checks|nixos-smoke|nixos-full" | head -20
  ```

  Expected: no evaluation errors; the check names appear in the output.

- [ ] **Step 5: Commit**

  ```bash
  git add flake.nix
  git commit -m "feat(checks): add installer-smoke to nixos-smoke; add nixpi-update and nixpi-options-validation to nixos-full"
  ```

---

## Task 9: Final verification

- [ ] **Step 1: Evaluate the full check set without building VMs**

  ```bash
  nix build .#checks.x86_64-linux.nixos-smoke --dry-run 2>&1 | tail -5
  nix build .#checks.x86_64-linux.nixos-full --dry-run 2>&1 | tail -5
  nix build .#checks.x86_64-linux.config --dry-run 2>&1 | tail -5
  ```

  Expected: All three complete without evaluation errors. `nixos-smoke` and `nixos-full` will show a large number of derivations to build (the VM tests themselves) — this is correct. Do not wait for them to build.

- [ ] **Step 2: Run the fast static checks**

  ```bash
  nix build .#checks.x86_64-linux.config
  nix build .#checks.x86_64-linux.installer-helper
  nix build .#checks.x86_64-linux.installer-frontend
  nix build .#checks.x86_64-linux.installer-backend
  ```

  Expected: All four succeed without errors.

- [ ] **Step 3: Final commit summary**

  No code change. Verify git log shows all commits from this plan:

  ```bash
  git log --oneline -8
  ```

  Expected output (newest first):
  ```
  <hash> feat(checks): add installer-smoke to nixos-smoke; add nixpi-update and nixpi-options-validation to nixos-full
  <hash> test: add nixpi-update deep integration test
  <hash> test: add nixpi-options-validation NixOS test
  <hash> refactor(tests): migrate nixpi-installer-smoke to runTest module pattern
  <hash> refactor(tests): migrate batch-2 test files to runTest module pattern
  <hash> refactor(tests): migrate batch-1 test files to runTest module pattern
  <hash> refactor(tests): migrate test loader to runTest module pattern
  <hash> docs: add NixOS test suite enhancement design spec
  ```
