# Headscale Admin Tailnet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the repository's WireGuard-first private management path with a self-hosted Headscale control plane and Tailscale-based admin tailnet clients.

**Architecture:** Add one native Headscale server module for the control-plane host and one native Tailscale client module for enrolled hosts, then delete the old `nixpi.wireguard` configuration path and update every operator-facing doc and test to describe the tailnet as the only supported private admin network. Keep the module interfaces narrow, keep secrets out of the Nix store, and verify the new path with NixOS tests plus doc guard updates.

**Tech Stack:** Nix flakes, NixOS modules, `services.headscale`, Tailscale client service, NixOS test driver, Vitest, Markdown docs

---

## File Map

### Create

- `core/os/modules/options/headscale.nix` - repository-level options for the Headscale server role
- `core/os/modules/options/tailnet.nix` - repository-level options for the admin tailnet client role
- `tests/nixos/nixpi-headscale.nix` - NixOS test covering Headscale server plus one enrolled client path

### Modify

- `core/os/modules/options.nix` - import the new Headscale and tailnet option modules and stop importing WireGuard options
- `core/os/modules/network.nix` - remove raw WireGuard handling and replace it with Tailnet/Tailscale-based admin networking behavior
- `core/os/modules/options/agent.nix` - replace the old default service/unit references if they still name `wireguard-wg0.service`
- `tests/nixos/default.nix` - replace `nixpi-wireguard` with `nixpi-headscale`
- `tests/nixos/nixpi-firstboot.nix` - replace WireGuard service assertions with new tailnet/client or server-side expectations
- `tests/nixos/nixpi-e2e.nix` - replace service expectations that mention `wireguard-wg0`
- `tests/nixos/nixpi-options-validation.nix` - replace `nixpi.wireguard` fixture coverage with `nixpi.headscale` and `nixpi.tailnet`
- `tests/os/broker.test.ts` - replace allowed unit names if they still require `wireguard-wg0.service`
- `tests/integration/standards-guard.test.ts` - replace WireGuard wording assertions with tailnet/Headscale wording assertions
- `flake.nix` - rename the exported NixOS test from `nixpi-wireguard` to `nixpi-headscale`
- `README.md` - replace WireGuard operational guidance with Headscale/tailnet guidance
- `docs/install.md` - replace verification commands and wording
- `docs/operations/first-boot-setup.md` - replace WireGuard verification flow
- `docs/operations/quick-deploy.md` - replace the “preferred private management network” wording
- `docs/operations/live-testing.md` - replace WireGuard checks with tailnet checks
- `docs/operations/index.md` - replace command snippets if they reference `wireguard-wg0.service`
- `docs/architecture/runtime-flows.md` - replace service tree and runtime entry documentation
- `docs/architecture/index.md` - replace architecture summary references
- `docs/reference/service-architecture.md` - replace service inventory
- `docs/reference/infrastructure.md` - replace infrastructure table and troubleshooting commands
- `docs/reference/security-model.md` - replace security perimeter language
- `docs/reference/index.md` - update navigation text if it still names WireGuard explicitly
- `docs/reference/supply-chain.md` - remove `wireguard-wg0` references
- `core/pi/skills/first-boot/SKILL.md` - replace operator guidance that assumes native WireGuard
- `core/pi/skills/builtin-services/SKILL.md` - replace built-in service descriptions
- `core/pi/extensions/persona/actions.ts` - replace “guide through WireGuard setup” wording

### Delete

- `core/os/modules/options/wireguard.nix` - old WireGuard option surface
- `tests/nixos/nixpi-wireguard.nix` - old WireGuard NixOS test

## Task 1: Add Repository-Level Headscale And Tailnet Options

**Files:**
- Create: `core/os/modules/options/headscale.nix`
- Create: `core/os/modules/options/tailnet.nix`
- Modify: `core/os/modules/options.nix`
- Test: `tests/nixos/nixpi-options-validation.nix`

- [ ] **Step 1: Write the failing option-validation assertions**

Add fixtures to `tests/nixos/nixpi-options-validation.nix` that prove the new option tree evaluates and the old one is no longer accepted.

```nix
{
  nixpi.headscale = {
    enable = true;
    serverUrl = "https://headscale.example.test";
  };

  nixpi.tailnet = {
    enable = true;
    loginServer = "https://headscale.example.test";
    authKeyFile = "/run/secrets/tailscale-auth-key";
  };
}
```

Add one negative assertion for the removed path:

```nix
{
  nixpi.wireguard.enable = true;
}
```
Expected failure message should mention that `nixpi.wireguard` no longer exists.

- [ ] **Step 2: Run the validation test to verify it fails for missing options**

Run: `XDG_CACHE_HOME=/tmp/nix-cache nix build .#checks.x86_64-linux.nixpi-options-validation --no-link`
Expected: FAIL with missing `nixpi.headscale` / `nixpi.tailnet` options or with stale WireGuard expectations still present in the test.

- [ ] **Step 3: Define the minimal Headscale option module**

Create `core/os/modules/options/headscale.nix` with a small, repo-focused option surface.

```nix
{ lib, ... }:

{
  options.nixpi.headscale = {
    enable = lib.mkEnableOption "self-hosted Headscale control plane";

    serverUrl = lib.mkOption {
      type = lib.types.str;
      example = "https://headscale.example.com";
      description = "Public URL advertised to tailnet clients.";
    };

    policyFile = lib.mkOption {
      type = with lib.types; nullOr str;
      default = null;
      description = "Optional runtime path to a Headscale policy file.";
    };

    settings = lib.mkOption {
      type = lib.types.attrs;
      default = { };
      description = "Additional native services.headscale.settings overrides.";
    };
  };
}
```

- [ ] **Step 4: Define the minimal tailnet client option module**

Create `core/os/modules/options/tailnet.nix` with only enrollment-centric fields.

```nix
{ lib, ... }:

{
  options.nixpi.tailnet = {
    enable = lib.mkEnableOption "admin tailnet client";

    loginServer = lib.mkOption {
      type = lib.types.str;
      example = "https://headscale.example.com";
      description = "Headscale login server used by the Tailscale client.";
    };

    authKeyFile = lib.mkOption {
      type = lib.types.str;
      example = "/run/secrets/tailscale-auth-key";
      description = "Runtime path to the auth key file used for enrollment.";
    };

    hostname = lib.mkOption {
      type = with lib.types; nullOr str;
      default = null;
      description = "Optional explicit tailnet hostname.";
    };

    extraUpFlags = lib.mkOption {
      type = with lib.types; listOf str;
      default = [ ];
      description = "Additional tailscale up flags kept outside the core abstraction.";
    };
  };
}
```

- [ ] **Step 5: Wire the new option modules into the option set**

Update `core/os/modules/options.nix` to import the new files and drop the WireGuard import.

```nix
[
  ./options/agent.nix
  ./options/app.nix
  ./options/bootstrap.nix
  ./options/headscale.nix
  ./options/security.nix
  ./options/tailnet.nix
]
```

- [ ] **Step 6: Re-run the option-validation test**

Run: `XDG_CACHE_HOME=/tmp/nix-cache nix build .#checks.x86_64-linux.nixpi-options-validation --no-link`
Expected: PASS for the new option tree and FAIL only when the test intentionally references the removed `nixpi.wireguard` path.

- [ ] **Step 7: Commit**

```bash
git add core/os/modules/options.nix core/os/modules/options/headscale.nix core/os/modules/options/tailnet.nix tests/nixos/nixpi-options-validation.nix
git commit -m "Define native headscale and tailnet option surfaces"
```

## Task 2: Replace WireGuard Networking Logic With Headscale Server And Tailnet Client Roles

**Files:**
- Modify: `core/os/modules/network.nix`
- Modify: `core/os/modules/options/agent.nix`
- Test: `tests/nixos/nixpi-firstboot.nix`
- Test: `tests/nixos/nixpi-e2e.nix`

- [ ] **Step 1: Write failing network-role assertions**

Update the affected tests to stop waiting for `wireguard-wg0.service` and instead assert the new services and commands.

Example assertions to add:

```python
nixpi.wait_for_unit("headscale.service", timeout=120)
nixpi.succeed("systemctl is-active headscale.service")
nixpi.succeed("tailscale version >/dev/null")
```

On client nodes:

```python
client.wait_for_unit("tailscaled.service", timeout=120)
client.succeed("systemctl is-active tailscaled.service")
client.succeed("tailscale status --json >/dev/null")
```

- [ ] **Step 2: Run the targeted tests to verify they fail on stale WireGuard behavior**

Run: `XDG_CACHE_HOME=/tmp/nix-cache nix build .#checks.x86_64-linux.nixpi-firstboot --no-link`
Expected: FAIL because the current module still produces `wireguard-wg0.service`-centric behavior.

Run: `XDG_CACHE_HOME=/tmp/nix-cache nix build .#checks.x86_64-linux.nixpi-e2e --no-link`
Expected: FAIL with stale service/unit expectations.

- [ ] **Step 3: Rewrite `core/os/modules/network.nix` around the new roles**

Replace `wgCfg`-based behavior with `headscaleCfg` and `tailnetCfg`, remove interface-specific firewall logic, and keep SSH as the admin protocol.

Target shape:

```nix
let
  headscaleCfg = config.nixpi.headscale;
  tailnetCfg = config.nixpi.tailnet;
in
{
  services.headscale = lib.mkIf headscaleCfg.enable {
    enable = true;
    settings =
      {
        server_url = headscaleCfg.serverUrl;
      }
      // lib.optionalAttrs (headscaleCfg.policyFile != null) {
        policy = {
          path = headscaleCfg.policyFile;
        };
      }
      // headscaleCfg.settings;
  };

  services.tailscale = lib.mkIf tailnetCfg.enable {
    enable = true;
    openFirewall = false;
  };
}
```

Add a one-shot login unit or equivalent only for the client role, using runtime secret files and explicit `--login-server`.

```nix
systemd.services.nixpi-tailnet-login = lib.mkIf tailnetCfg.enable {
  after = [ "network-online.target" "tailscaled.service" ];
  wants = [ "network-online.target" "tailscaled.service" ];
  wantedBy = [ "multi-user.target" ];
  serviceConfig.Type = "oneshot";
  script = ''
    auth_key="$(cat ${tailnetCfg.authKeyFile})"
    ${lib.getExe pkgs.tailscale} up \
      --login-server=${tailnetCfg.loginServer} \
      ${lib.optionalString (tailnetCfg.hostname != null) "--hostname=${tailnetCfg.hostname}"} \
      --auth-key="$auth_key" \
      ${lib.concatStringsSep " " tailnetCfg.extraUpFlags}
  '';
};
```

- [ ] **Step 4: Replace stale agent unit references**

Update `core/os/modules/options/agent.nix` so any allowlist or expected-unit list no longer includes `wireguard-wg0.service`.

Example replacement:

```nix
[
  "tailscaled.service"
  "nixpi-tailnet-login.service"
]
```

If `headscale.service` belongs only on the control-plane host, do not add it to host-global defaults unless the current file genuinely models role-specific services.

- [ ] **Step 5: Re-run the targeted tests**

Run: `XDG_CACHE_HOME=/tmp/nix-cache nix build .#checks.x86_64-linux.nixpi-firstboot --no-link`
Expected: PASS with `headscale.service` and/or `tailscaled.service` in the expected states.

Run: `XDG_CACHE_HOME=/tmp/nix-cache nix build .#checks.x86_64-linux.nixpi-e2e --no-link`
Expected: PASS with no `wireguard-wg0.service` dependency remaining.

- [ ] **Step 6: Commit**

```bash
git add core/os/modules/network.nix core/os/modules/options/agent.nix tests/nixos/nixpi-firstboot.nix tests/nixos/nixpi-e2e.nix
git commit -m "Replace WireGuard networking with headscale and tailnet roles"
```

## Task 3: Replace The Dedicated WireGuard NixOS Test With A Headscale End-To-End Test

**Files:**
- Create: `tests/nixos/nixpi-headscale.nix`
- Modify: `tests/nixos/default.nix`
- Modify: `flake.nix`
- Delete: `tests/nixos/nixpi-wireguard.nix`

- [ ] **Step 1: Write the failing test entrypoint changes**

Update `tests/nixos/default.nix` and `flake.nix` to reference `nixpi-headscale` instead of `nixpi-wireguard`.

```nix
nixpi-headscale = runTest ./nixpi-headscale.nix;
```

```nix
name = "nixpi-headscale";
path = nixosTests.nixpi-headscale;
```

- [ ] **Step 2: Run the dedicated NixOS test target to verify it fails because the file does not exist yet**

Run: `XDG_CACHE_HOME=/tmp/nix-cache nix build .#checks.x86_64-linux.nixpi-headscale --no-link`
Expected: FAIL because `tests/nixos/nixpi-headscale.nix` is missing or because references still point at `nixpi-wireguard`.

- [ ] **Step 3: Create the new Headscale test**

Create `tests/nixos/nixpi-headscale.nix` with one control-plane node and one enrolled client node.

Skeleton:

```nix
{
  lib,
  mkTestFilesystems,
  ...
}:
{
  name = "nixpi-headscale";

  nodes.nixpi = { ... }: {
    imports = [ ../../core/os/hosts/vps.nix mkTestFilesystems ];

    nixpi.headscale = {
      enable = true;
      serverUrl = "http://nixpi:8080";
    };
  };

  nodes.client = { ... }: {
    imports = [ mkTestFilesystems ];

    nixpi.tailnet = {
      enable = true;
      loginServer = "http://nixpi:8080";
      authKeyFile = "/run/secrets/tailscale-auth-key";
      hostname = "client";
    };
  };
}
```

Use the test script to:

```python
nixpi.wait_for_unit("headscale.service", timeout=120)
client.wait_for_unit("tailscaled.service", timeout=120)
nixpi.succeed("headscale users create admin")
nixpi.succeed("headscale preauthkeys create --user admin --reusable --output json > /run/headscale-preauth.json")
client.wait_until_succeeds("tailscale status --json >/dev/null", timeout=120)
```

Then verify the admin path:

```python
nixpi.wait_until_succeeds("headscale nodes list -o json | jq -e 'length >= 1'", timeout=120)
client.succeed("tailscale ip -4")
```

- [ ] **Step 4: Delete the old WireGuard test**

Remove `tests/nixos/nixpi-wireguard.nix` once the new test is in place.

```bash
git rm tests/nixos/nixpi-wireguard.nix
```

- [ ] **Step 5: Run the new dedicated NixOS test**

Run: `XDG_CACHE_HOME=/tmp/nix-cache nix build .#checks.x86_64-linux.nixpi-headscale --no-link`
Expected: PASS with the client enrolled in Headscale and visible in the control-plane node list.

- [ ] **Step 6: Commit**

```bash
git add tests/nixos/default.nix tests/nixos/nixpi-headscale.nix flake.nix
git commit -m "Replace the WireGuard NixOS test with headscale coverage"
```

## Task 4: Update Docs, Skills, And Guard Tests To Describe The Tailnet-Only Model

**Files:**
- Modify: `README.md`
- Modify: `docs/install.md`
- Modify: `docs/operations/first-boot-setup.md`
- Modify: `docs/operations/quick-deploy.md`
- Modify: `docs/operations/live-testing.md`
- Modify: `docs/operations/index.md`
- Modify: `docs/architecture/runtime-flows.md`
- Modify: `docs/architecture/index.md`
- Modify: `docs/reference/service-architecture.md`
- Modify: `docs/reference/infrastructure.md`
- Modify: `docs/reference/security-model.md`
- Modify: `docs/reference/index.md`
- Modify: `docs/reference/supply-chain.md`
- Modify: `core/pi/skills/first-boot/SKILL.md`
- Modify: `core/pi/skills/builtin-services/SKILL.md`
- Modify: `core/pi/extensions/persona/actions.ts`
- Modify: `tests/integration/standards-guard.test.ts`
- Modify: `tests/os/broker.test.ts`

- [ ] **Step 1: Write the failing guard assertions**

Update `tests/integration/standards-guard.test.ts` to expect Headscale/tailnet language instead of WireGuard language.

Examples:

```ts
expect(quickDeployDoc).toContain("trusted admin tailnet");
expect(liveTestingDoc).toContain("tailnet reachability");
expect(infrastructureDoc).toContain("tailscaled.service");
expect(serviceArchitectureDoc).toContain("headscale.service");
```

Also update any unit allowlists in `tests/os/broker.test.ts` that still mention `wireguard-wg0.service`.

- [ ] **Step 2: Run the guard tests to verify they fail on stale docs**

Run: `npm run test:unit -- tests/integration/standards-guard.test.ts tests/os/broker.test.ts`
Expected: FAIL because docs and unit allowlists still contain WireGuard language.

- [ ] **Step 3: Rewrite the key docs and skills**

Make the wording replacement explicit and complete.

Example replacement for `docs/reference/service-architecture.md`:

```md
| `nixpi-app-setup.service` | Seeds the Pi runtime state under `~/.pi` |
| `sshd.service` | Remote shell access |
| `headscale.service` | Control plane for the admin tailnet on the designated server host |
| `tailscaled.service` | Tailnet client on enrolled hosts |
```

Example replacement for `docs/reference/security-model.md`:

```md
- SSH for remote administration
- local terminal login on monitor-attached hardware
- optional Headscale-managed tailnet for the private admin network
```

Example replacement for operator commands:

```bash
systemctl status headscale.service
systemctl status tailscaled.service
tailscale status
```

- [ ] **Step 4: Re-run the guard tests**

Run: `npm run test:unit -- tests/integration/standards-guard.test.ts tests/os/broker.test.ts`
Expected: PASS with no WireGuard-specific operator guidance left in the guarded surfaces.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/install.md docs/operations/first-boot-setup.md docs/operations/quick-deploy.md docs/operations/live-testing.md docs/operations/index.md docs/architecture/runtime-flows.md docs/architecture/index.md docs/reference/service-architecture.md docs/reference/infrastructure.md docs/reference/security-model.md docs/reference/index.md docs/reference/supply-chain.md core/pi/skills/first-boot/SKILL.md core/pi/skills/builtin-services/SKILL.md core/pi/extensions/persona/actions.ts tests/integration/standards-guard.test.ts tests/os/broker.test.ts
git commit -m "Rewrite operator guidance around the headscale admin tailnet"
```

## Task 5: Delete The Remaining WireGuard Path And Run Full Verification

**Files:**
- Delete: `core/os/modules/options/wireguard.nix`
- Modify: `core/os/modules/network.nix`
- Modify: `tests/nixos/default.nix`
- Modify: `flake.nix`
- Modify: all files still returned by `rg -n "wireguard|wg0" .`

- [ ] **Step 1: Search for remaining WireGuard references and make that list go red**

Run:

```bash
rg -n "wireguard|wg0" core tests docs README.md flake.nix
```

Expected: Remaining matches should be only the places you are about to delete or rename. Any surviving operator-facing or module-facing reference is unfinished work.

- [ ] **Step 2: Delete the option module and remove any stale imports or code paths**

Remove the old WireGuard option file and any leftover `wgCfg` logic.

```bash
git rm core/os/modules/options/wireguard.nix
```

The final module state should not contain constructs like:

```nix
networking.wireguard.interfaces = ...
networking.firewall.allowedUDPPorts = lib.optionals wgCfg.enable [ wgCfg.listenPort ];
```

- [ ] **Step 3: Run repo verification in increasing scope**

Run: `npm run check`
Expected: PASS

Run: `npm run test:unit`
Expected: PASS

Run: `XDG_CACHE_HOME=/tmp/nix-cache nix build .#checks.x86_64-linux.nixpi-options-validation --no-link`
Expected: PASS

Run: `XDG_CACHE_HOME=/tmp/nix-cache nix build .#checks.x86_64-linux.nixpi-headscale --no-link`
Expected: PASS

Run: `XDG_CACHE_HOME=/tmp/nix-cache nix build .#checks.x86_64-linux.nixpi-firstboot --no-link`
Expected: PASS

Run: `XDG_CACHE_HOME=/tmp/nix-cache nix build .#checks.x86_64-linux.nixpi-e2e --no-link`
Expected: PASS

- [ ] **Step 4: Re-run the WireGuard search to prove the old platform path is gone**

Run:

```bash
rg -n "wireguard|wg0" core tests docs README.md flake.nix
```

Expected: no matches in supported platform code or docs, or only deliberate historical/spec references outside the live implementation surface.

- [ ] **Step 5: Commit**

```bash
git add core/os/modules/network.nix core/os/modules/options.nix tests/nixos/default.nix flake.nix docs README.md tests core
git commit -m "Delete the old WireGuard management path"
```

## Spec Coverage Check

- Headscale as a built-in service on one managed NixOS host: covered by Tasks 1, 2, and 3.
- Managed host enrollment into a Headscale-backed admin tailnet: covered by Tasks 1, 2, and 3.
- Replace WireGuard-specific docs, tests, and platform concepts: covered by Tasks 3, 4, and 5.
- No backward compatibility: covered by Tasks 1 and 5, especially the explicit deletion steps.
- Keep secrets out of the Nix store: covered by Tasks 1 and 2 through runtime file paths and login-unit design.

## Self-Review Notes

- Placeholder scan: removed `TODO`-style wording; each task has explicit files, commands, and target code shape.
- Type consistency: the plan consistently uses `nixpi.headscale.serverUrl`, `nixpi.headscale.policyFile`, `nixpi.tailnet.loginServer`, and `nixpi.tailnet.authKeyFile`.
- Scope check: the plan stays within one migration track and does not split into unrelated networking features such as exit nodes or subnet routing.
