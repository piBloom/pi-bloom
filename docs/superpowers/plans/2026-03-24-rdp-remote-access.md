# RDP Remote Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add xrdp to `desktop-xfce.nix` so the VM's XFCE desktop is reachable via RDP from the Netbird mesh network (`wt0`), firewalled to that interface only.

**Architecture:** Enable `services.xrdp` with `xfce4-session` as the window manager directly in `desktop-xfce.nix`. Add port 3389 to the per-interface firewall for `trustedInterface` (defaults to `wt0`). Write a NixOS VM test that verifies the services are active and the port is listening.

**Tech Stack:** NixOS modules (Nix), xrdp, XFCE, NixOS VM testing framework (`pkgs.testers.runNixOSTest`)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `core/os/modules/desktop-xfce.nix` | Modify | Add xrdp service + wt0 firewall rule |
| `tests/nixos/nixpi-rdp.nix` | Create | NixOS VM test for xrdp service |
| `tests/nixos/default.nix` | Modify | Register `nixpi-rdp` test |
| `flake.nix` | Modify | Add `nixpi-rdp` to `nixos-full` check lane |

---

## Task 1: Add xrdp to `desktop-xfce.nix`

**Files:**
- Modify: `core/os/modules/desktop-xfce.nix`

- [ ] **Step 1: Read the current file**

  Read `core/os/modules/desktop-xfce.nix` to locate the right insertion point. The file ends with a `system.activationScripts` block. The two new lines go inside the top-level `{  }` config block, after the existing `systemd.defaultUnit` line (around line 182).

- [ ] **Step 2: Add xrdp service and firewall rule**

  Add the following two blocks inside the module's attribute set, after `services.displayManager.autoLogin.user`:

  ```nix
  services.xrdp = {
    enable = true;
    defaultWindowManager = "${pkgs.xfce.xfce4-session}/bin/xfce4-session";
    openFirewall = false;
  };

  networking.firewall.interfaces."${securityCfg.trustedInterface}".allowedTCPPorts = [ 3389 ];
  ```

  **Important details:**
  - `securityCfg` is **not** currently bound in `desktop-xfce.nix` (`network.nix` has it, but the desktop module does not). Add this binding in the `let` block at the top of the file:
    ```nix
    securityCfg = config.nixpi.security;
    ```
  - `openFirewall = false` — we manage the firewall manually via the interface-scoped rule.
  - The `networking.firewall.interfaces` list merges across modules; this stacks with `network.nix`'s existing rules without conflict.

- [ ] **Step 3: Verify the Nix expression evaluates**

  ```bash
  nix build .#nixosConfigurations.x86_64-vm --no-link -L 2>&1 | tail -20
  ```

  Expected: build succeeds (or at minimum, no parse/eval errors about the xrdp config).

- [ ] **Step 4: Commit**

  ```bash
  git add core/os/modules/desktop-xfce.nix
  git commit -m "feat(desktop): add xrdp session-based remote access via netbird"
  ```

---

## Task 2: Write the NixOS test

**Files:**
- Create: `tests/nixos/nixpi-rdp.nix`

- [ ] **Step 1: Write the test file**

  Model this after `tests/nixos/nixpi-desktop.nix` — same imports, same node structure, add xrdp-specific assertions.

  ```nix
  # tests/nixos/nixpi-rdp.nix
  { nixPiModules, piAgent, appPackage, setupPackage, ... }:

  {
    name = "nixpi-rdp";

    nodes.nixpi = { ... }: {
      imports = [
        ../../core/os/modules/firstboot.nix
        ../../core/os/modules/desktop-xfce.nix
        {
          fileSystems."/" = { device = "/dev/vda"; fsType = "ext4"; };
          fileSystems."/boot" = { device = "/dev/vda1"; fsType = "vfat"; };
        }
      ] ++ nixPiModules;
      _module.args = { inherit piAgent appPackage setupPackage; };

      services.xserver.xkb = { layout = "us"; variant = ""; };
      console.keyMap = "us";

      nixpi.primaryUser = "pi";
      networking.hostName = "nixpi-rdp-test";

      virtualisation.diskSize = 20480;
      virtualisation.memorySize = 4096;
      virtualisation.graphics = true;
    };

    testScript = ''
      nixpi = machines[0]

      nixpi.start()
      nixpi.wait_for_unit("display-manager.service", timeout=300)
      nixpi.wait_for_unit("xrdp.service", timeout=60)
      nixpi.wait_for_unit("xrdp-sesman.service", timeout=60)

      nixpi.succeed("systemctl is-active xrdp.service")
      nixpi.succeed("systemctl is-active xrdp-sesman.service")

      # Verify port 3389 is listening
      nixpi.wait_until_succeeds("ss -tlnp | grep -q ':3389'", timeout=30)
    '';
  }
  ```

  **Note on `xrdp-sesman`:** If the nixpkgs revision in this project predates the sesman split, `xrdp-sesman.service` may not exist as a separate unit. If the `wait_for_unit` call fails with "unit not found", remove the `xrdp-sesman` lines and keep only the `xrdp.service` checks.

- [ ] **Step 2: Register the test in `tests/nixos/default.nix`**

  Open `tests/nixos/default.nix`. In the `tests = { ... }` attrset, add after `nixpi-desktop`:

  ```nix
  nixpi-rdp = runTest ./nixpi-rdp.nix;
  ```

- [ ] **Step 3: Add test to `nixos-full` lane in `flake.nix`**

  In `flake.nix`, find the `nixos-full = mkCheckLane "nixos-full" [` block. Add after the `nixpi-desktop` entry:

  ```nix
  { name = "nixpi-rdp"; path = nixosTests.nixpi-rdp; }
  ```

- [ ] **Step 4: Run the test**

  ```bash
  nix build .#checks.x86_64-linux.nixpi-rdp --no-link -L 2>&1 | tail -40
  ```

  Expected: test passes — `xrdp.service` active, port 3389 listening.

  If `xrdp-sesman.service` fails (unit not found), remove those two lines from the test script and re-run.

- [ ] **Step 5: Commit**

  ```bash
  git add tests/nixos/nixpi-rdp.nix tests/nixos/default.nix flake.nix
  git commit -m "test(rdp): add NixOS VM test for xrdp service and port availability"
  ```

---

## Verification

- [ ] Run the full desktop smoke test to confirm nothing regressed:

  ```bash
  just check-desktop-interaction
  ```

  Or the NixOS smoke lane:

  ```bash
  just check-nixos-smoke
  ```

- [ ] Confirm both commits are clean with `git log --oneline -3`.
