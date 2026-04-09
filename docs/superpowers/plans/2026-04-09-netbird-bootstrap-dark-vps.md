# NetBird Bootstrap Dark VPS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current Headscale/Tailscale-based private admin direction with a managed NetBird client bootstrap flow that enrolls the VPS during install and converges to a dark steady state.

**Architecture:** Remove the current Headscale/Tailscale option and test surfaces, add a thin NetBird client configuration that mirrors the native NixOS module shape, and extend the OVH deploy wrapper to accept a local NetBird setup-key file path. Bootstrap keeps public SSH as a temporary recovery path, while steady-state closes public SSH and relies on NetBird plus OVH KVM for administrative access.

**Tech Stack:** Nix flakes, NixOS modules, `services.netbird.clients`, OVH nixos-anywhere wrapper, NixOS test driver, Vitest, Markdown docs

---

## File Map

### Create

- `core/os/modules/options/netbird.nix` - repository-level NetBird client options aligned with the native NixOS module shape
- `tests/nixos/nixpi-netbird.nix` - dedicated NetBird-oriented NixOS test replacing the current Headscale-specific test

### Modify

- `core/os/modules/options.nix` - import NetBird options and stop importing Headscale/Tailnet options
- `core/os/modules/network.nix` - remove Headscale/Tailscale wiring and switch to native NetBird client wiring
- `core/os/modules/options/agent.nix` - replace `tailscaled.service` allowlist defaults with the appropriate NetBird unit(s)
- `core/os/hosts/ovh-vps.nix` - bootstrap/steady-state SSH behavior changes for the dark-host model
- `core/scripts/nixpi-deploy-ovh.sh` - accept a local setup-key file path and carry it into bootstrap config without embedding the secret in the store
- `tests/integration/nixpi-deploy-ovh.test.ts` - wrapper regression tests for setup-key file handling
- `tests/nixos/default.nix` - replace `nixpi-headscale` with `nixpi-netbird`
- `tests/nixos/nixpi-options-validation.nix` - replace Headscale/Tailnet option coverage with NetBird option coverage
- `tests/nixos/nixpi-firstboot.nix` - replace current tailnet expectations with NetBird/bootstrap-fallback expectations
- `tests/nixos/nixpi-e2e.nix` - replace service/package expectations as needed
- `tests/nixos/README.md` - replace the dedicated test name and purpose
- `tests/os/broker.test.ts` - replace `tailscaled.service` allowlist expectations
- `tests/integration/standards-guard.test.ts` - replace Headscale/Tailscale wording assertions with NetBird wording assertions
- `README.md` - replace current tailnet guidance
- `docs/install.md` - update installed-host verification commands and wording
- `docs/operations/first-boot-setup.md` - rewrite first-boot private-network verification around NetBird
- `docs/operations/quick-deploy.md` - rewrite deployment/security wording around NetBird bootstrap and dark steady state
- `docs/operations/live-testing.md` - rewrite live-validation steps around NetBird bootstrap and dark steady state
- `docs/operations/index.md` - update service-inspection commands
- `docs/architecture/runtime-flows.md` - replace operator-entry flow references
- `docs/architecture/index.md` - replace built-in services summary
- `docs/reference/service-architecture.md` - replace service inventory
- `docs/reference/infrastructure.md` - replace infrastructure table and troubleshooting commands
- `docs/reference/security-model.md` - replace private-admin threat model wording
- `docs/reference/index.md` - update reference topic description
- `docs/reference/supply-chain.md` - replace Headscale/Tailscale package mentions
- `core/pi/skills/first-boot/SKILL.md` - replace admin-tailnet setup guidance with NetBird guidance
- `core/pi/skills/builtin-services/SKILL.md` - replace current private-network service references
- `core/pi/extensions/persona/actions.ts` - replace “admin-tailnet setup” wording

### Delete

- `core/os/modules/options/headscale.nix` - retired Headscale option surface
- `core/os/modules/options/tailnet.nix` - retired Tailscale/Tailnet option surface
- `tests/nixos/nixpi-headscale.nix` - retired Headscale/Tailscale end-to-end test

## Task 1: Replace Headscale/Tailnet Options With A Thin NetBird Option Surface

**Files:**
- Create: `core/os/modules/options/netbird.nix`
- Modify: `core/os/modules/options.nix`
- Modify: `tests/nixos/nixpi-options-validation.nix`
- Delete: `core/os/modules/options/headscale.nix`
- Delete: `core/os/modules/options/tailnet.nix`

- [ ] **Step 1: Write the failing options-validation updates**

Update `tests/nixos/nixpi-options-validation.nix` to validate the new NetBird option tree instead of `nixpi.headscale` / `nixpi.tailnet`.

Target fixture:

```nix
{
  nixpi.netbird = {
    enable = true;
    setupKeyFile = "/run/secrets/netbird-setup-key";
    clientName = "nixpi-managed-node";
  };
}
```

Validation outputs should assert the option tree exists and the configured values evaluate correctly.

- [ ] **Step 2: Run the options-validation target to verify it fails before the new option module exists**

Run: `XDG_CACHE_HOME=/tmp/nix-cache nix build .#checks.x86_64-linux.nixpi-options-validation --no-link`
Expected: FAIL with missing `nixpi.netbird` options or stale Headscale/Tailnet expectations.

- [ ] **Step 3: Create the NetBird option module**

Create `core/os/modules/options/netbird.nix` with a minimal repository-level surface that maps cleanly to the native NixOS NetBird client module.

```nix
{ lib, ... }:

{
  options.nixpi.netbird = {
    enable = lib.mkEnableOption "managed NetBird client bootstrap";

    setupKeyFile = lib.mkOption {
      type = lib.types.str;
      example = "/run/secrets/netbird-setup-key";
      description = ''
        Runtime path to a NetBird setup key file used for automated enrollment.
      '';
    };

    clientName = lib.mkOption {
      type = with lib.types; nullOr str;
      default = null;
      description = ''
        Optional NetBird client name to advertise during enrollment.
      '';
    };

    managementUrl = lib.mkOption {
      type = with lib.types; nullOr str;
      default = null;
      description = ''
        Optional override for non-default NetBird management URLs.
      '';
    };
  };
}
```

- [ ] **Step 4: Switch the option aggregator to NetBird**

Update `core/os/modules/options.nix` to import `./options/netbird.nix` and remove the Headscale/Tailnet option imports.

```nix
[
  ./options/core.nix
  ./options/bootstrap.nix
  ./options/security.nix
  ./options/agent.nix
  ./options/netbird.nix
]
```

- [ ] **Step 5: Delete the retired option modules**

Remove the old files once the new option module is in place.

```bash
git rm core/os/modules/options/headscale.nix
git rm core/os/modules/options/tailnet.nix
```

- [ ] **Step 6: Update the options-validation assertions to the new shape**

Replace the current Headscale/Tailnet assertions with NetBird-specific assertions.

Examples:

```python
defaults.succeed("grep -qx 'yes' /etc/nixpi-tests/has-netbird-option")
overrides.succeed("grep -qx 'yes' /etc/nixpi-tests/netbird-enable")
overrides.succeed("grep -qx '/run/secrets/netbird-setup-key' /etc/nixpi-tests/netbird-setup-key-file")
overrides.succeed("grep -qx 'nixpi-managed-node' /etc/nixpi-tests/netbird-client-name")
```

- [ ] **Step 7: Re-run the options-validation target**

Run: `XDG_CACHE_HOME=/tmp/nix-cache nix build .#checks.x86_64-linux.nixpi-options-validation --no-link`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add core/os/modules/options.nix core/os/modules/options/netbird.nix tests/nixos/nixpi-options-validation.nix
git commit -m "Define a native NetBird bootstrap option surface"
```

## Task 2: Replace Network Wiring With Native NetBird Client Behavior

**Files:**
- Modify: `core/os/modules/network.nix`
- Modify: `core/os/modules/options/agent.nix`
- Modify: `tests/nixos/nixpi-firstboot.nix`
- Modify: `tests/nixos/nixpi-e2e.nix`

- [ ] **Step 1: Write the failing test updates**

Update the affected NixOS tests so they stop expecting Headscale/Tailscale-specific services and instead expect NetBird client behavior.

Examples:

```python
nixpi.wait_for_unit("netbird-wt0.service", timeout=120)
nixpi.succeed("command -v netbird-wt0")
```

If the actual generated unit names differ, use the names emitted by the native NixOS NetBird module and keep the test aligned with those exact unit names.

- [ ] **Step 2: Run the targeted tests to verify they fail on stale service expectations**

Run: `XDG_CACHE_HOME=/tmp/nix-cache nix build .#checks.x86_64-linux.nixpi-firstboot --no-link`
Expected: FAIL on stale Tailscale/Headscale assumptions.

Run: `XDG_CACHE_HOME=/tmp/nix-cache nix build .#checks.x86_64-linux.nixpi-e2e --no-link`
Expected: FAIL on stale private-network expectations.

- [ ] **Step 3: Replace the current networking logic with native NetBird client wiring**

Update `core/os/modules/network.nix` to remove `nixpi.headscale` / `nixpi.tailnet` logic and instead configure the native NixOS NetBird client module.

Target shape:

```nix
let
  netbirdCfg = config.nixpi.netbird;
in
{
  services.resolved.enable = lib.mkIf netbirdCfg.enable true;

  services.netbird.clients.wt0 = lib.mkIf netbirdCfg.enable {
    login = {
      enable = true;
      setupKeyFile = netbirdCfg.setupKeyFile;
    };
    ui.enable = false;
    openFirewall = true;
    openInternalFirewall = true;
  };
}
```

If the native module supports a hostname/client-name field directly, use it. If not, add the smallest possible repo-local wiring that maps to the correct CLI flags or environment.

Do not add a new generalized networking abstraction.

- [ ] **Step 4: Update broker allowlisted units**

Replace `tailscaled.service` defaults in `core/os/modules/options/agent.nix` with the actual NetBird client service unit(s) the broker should be allowed to inspect.

Example:

```nix
default = [
  "netbird-wt0.service"
  "nixpi-update.service"
];
```

Use the real generated unit name from the NixOS NetBird module.

- [ ] **Step 5: Re-run the targeted tests**

Run: `XDG_CACHE_HOME=/tmp/nix-cache nix build .#checks.x86_64-linux.nixpi-firstboot --no-link`
Expected: PASS or move forward to the next real failure.

Run: `XDG_CACHE_HOME=/tmp/nix-cache nix build .#checks.x86_64-linux.nixpi-e2e --no-link`
Expected: PASS or move forward to the next real failure.

- [ ] **Step 6: Commit**

```bash
git add core/os/modules/network.nix core/os/modules/options/agent.nix tests/nixos/nixpi-firstboot.nix tests/nixos/nixpi-e2e.nix
git commit -m "Wire NixPI private admin access through NetBird"
```

## Task 3: Extend The OVH Deploy Wrapper To Accept A NetBird Setup-Key File Path

**Files:**
- Modify: `core/scripts/nixpi-deploy-ovh.sh`
- Modify: `tests/integration/nixpi-deploy-ovh.test.ts`
- Modify: `core/os/hosts/ovh-vps.nix`

- [ ] **Step 1: Write the failing wrapper tests**

Add tests that cover:

- `--netbird-setup-key-file /path/to/key`
- missing file path errors
- generated flake/bootstrap module references runtime file material rather than embedding literal key contents

Example assertions:

```ts
expect(result.stdout).toContain("--netbird-setup-key-file");
expect(generatedFlake).toContain("nixpi.netbird.enable = lib.mkForce true;");
expect(generatedFlake).toContain('setupKeyFile = "/run/secrets/netbird-setup-key";');
expect(generatedFlake).not.toContain("ACTUAL-SETUP-KEY-VALUE");
```

- [ ] **Step 2: Run the wrapper tests to verify they fail before implementation**

Run: `npm run test:unit -- tests/integration/nixpi-deploy-ovh.test.ts`
Expected: FAIL with unknown flag or missing expected config output.

- [ ] **Step 3: Add the new wrapper argument and validation**

Update `core/scripts/nixpi-deploy-ovh.sh` to accept:

```bash
--netbird-setup-key-file /absolute/or/relative/path
```

Validate that the file exists locally before generating the deploy flake.

Expected shell shape:

```bash
if [[ -n "$netbird_setup_key_file" && ! -f "$netbird_setup_key_file" ]]; then
  log "--netbird-setup-key-file must point to an existing local file"
  exit 1
fi
```

- [ ] **Step 4: Carry the setup key into bootstrap config without embedding the secret**

Update the generated bootstrap module so it references runtime secret material, not the literal key value in Nix.

The plan should stay explicit about the target runtime path, for example:

```nix
nixpi.netbird = {
  enable = lib.mkForce true;
  setupKeyFile = "/run/secrets/netbird-setup-key";
};
```

And the wrapper should make that file available on the target during install/bootstrap using the existing installer-side secret transport mechanism or the smallest new mechanism necessary.

- [ ] **Step 5: Adjust OVH host bootstrap behavior for NetBird fallback**

Update `core/os/hosts/ovh-vps.nix` so bootstrap still permits public SSH and forced password rotation, but the steady-state design can later close public SSH once NetBird is established.

Do not make the host dark on first boot before NetBird is known-good.

- [ ] **Step 6: Re-run the wrapper tests**

Run: `npm run test:unit -- tests/integration/nixpi-deploy-ovh.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add core/scripts/nixpi-deploy-ovh.sh tests/integration/nixpi-deploy-ovh.test.ts core/os/hosts/ovh-vps.nix
git commit -m "Accept NetBird setup-key files during OVH bootstrap"
```

## Task 4: Replace The Dedicated Headscale Test With A NetBird-Oriented Test

**Files:**
- Create: `tests/nixos/nixpi-netbird.nix`
- Modify: `tests/nixos/default.nix`
- Modify: `tests/nixos/README.md`
- Modify: `flake.nix`
- Delete: `tests/nixos/nixpi-headscale.nix`

- [ ] **Step 1: Write the failing test-entrypoint updates**

Replace `nixpi-headscale` references with `nixpi-netbird`.

```nix
nixpi-netbird = runTest ./nixpi-netbird.nix;
```

```nix
name = "nixpi-netbird";
path = nixosTests.nixpi-netbird;
```

- [ ] **Step 2: Run the dedicated target to verify it fails before the test exists**

Run: `XDG_CACHE_HOME=/tmp/nix-cache nix build .#checks.x86_64-linux.nixpi-netbird --no-link`
Expected: FAIL because the new test file is missing or references are stale.

- [ ] **Step 3: Create the new NetBird-oriented NixOS test**

If full deterministic managed-service enrollment is not practical, make this a focused local test that verifies the repository emits the correct NetBird client shape.

Suggested assertions:

```python
nixpi.wait_for_unit("multi-user.target", timeout=300)
nixpi.succeed("command -v netbird-wt0")
nixpi.succeed("systemctl cat netbird-wt0.service >/dev/null")
nixpi.succeed("systemctl cat netbird-wt0.service | grep -q '/run/secrets/netbird-setup-key'")
nixpi.succeed("systemctl cat systemd-resolved.service >/dev/null")
```

Also verify the host remains in bootstrap-compatible access mode where intended.

- [ ] **Step 4: Delete the old Headscale-specific test**

```bash
git rm tests/nixos/nixpi-headscale.nix
```

- [ ] **Step 5: Run the new dedicated test**

Run: `XDG_CACHE_HOME=/tmp/nix-cache nix build .#checks.x86_64-linux.nixpi-netbird --no-link`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add tests/nixos/default.nix tests/nixos/nixpi-netbird.nix tests/nixos/README.md flake.nix
git commit -m "Replace the dedicated headscale VM test with NetBird coverage"
```

## Task 5: Rewrite Docs, Skills, And Guard Tests Around NetBird Bootstrap And Dark Steady State

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

Update `tests/integration/standards-guard.test.ts` and `tests/os/broker.test.ts` so they expect NetBird wording and unit names.

Examples:

```ts
expect(quickDeployDoc).toContain("NetBird");
expect(liveTestingDoc).toContain("bootstrap SSH as temporary only");
expect(infrastructureDoc).toContain("netbird");
```

```ts
allowedUnits: ["netbird-wt0.service", "nixpi-update.service"]
```

- [ ] **Step 2: Run the targeted guard/unit tests to verify they fail before doc updates**

Run: `npm run test:unit -- tests/integration/standards-guard.test.ts tests/os/broker.test.ts`
Expected: FAIL on stale Headscale/Tailscale wording and unit expectations.

- [ ] **Step 3: Rewrite the operator story**

Update the docs and skills to describe:

- managed NetBird service
- setup-key file at install time
- bootstrap public SSH as temporary only
- dark steady state
- OVH KVM as break-glass access

Replace service/command snippets with the native NetBird client names and commands that the NixOS module emits, for example:

```bash
systemctl status netbird-wt0.service
netbird-wt0 status
```

If the generated CLI name differs, use the exact command produced by the native module.

- [ ] **Step 4: Re-run the targeted guard/unit tests**

Run: `npm run test:unit -- tests/integration/standards-guard.test.ts tests/os/broker.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add README.md docs/install.md docs/operations/first-boot-setup.md docs/operations/quick-deploy.md docs/operations/live-testing.md docs/operations/index.md docs/architecture/runtime-flows.md docs/architecture/index.md docs/reference/service-architecture.md docs/reference/infrastructure.md docs/reference/security-model.md docs/reference/index.md docs/reference/supply-chain.md core/pi/skills/first-boot/SKILL.md core/pi/skills/builtin-services/SKILL.md core/pi/extensions/persona/actions.ts tests/integration/standards-guard.test.ts tests/os/broker.test.ts
git commit -m "Rewrite operator guidance around NetBird bootstrap"
```

## Task 6: Run Final Verification And Replace Remaining Headscale/Tailscale Surfaces

**Files:**
- Modify: any remaining live implementation files returned by targeted searches
- Delete: any remaining retired Headscale/Tailscale live files

- [ ] **Step 1: Search for remaining live Headscale/Tailscale references**

Run:

```bash
rg -n "headscale|tailscale|tailnet|tailscaled" core tests docs README.md flake.nix
```

Expected: remaining hits should be only historical specs/plans or intentionally retained migration context, not live implementation surfaces.

- [ ] **Step 2: Run repository verification in increasing scope**

Run: `npm run check`
Expected: PASS

Run: `npm run test:unit`
Expected: PASS

Run: `XDG_CACHE_HOME=/tmp/nix-cache nix build .#checks.x86_64-linux.nixpi-options-validation --no-link`
Expected: PASS

Run: `XDG_CACHE_HOME=/tmp/nix-cache nix build .#checks.x86_64-linux.nixpi-netbird --no-link`
Expected: PASS

Run: `XDG_CACHE_HOME=/tmp/nix-cache nix build .#checks.x86_64-linux.nixos-smoke --no-link`
Expected: PASS

Run: `XDG_CACHE_HOME=/tmp/nix-cache nix build .#checks.x86_64-linux.nixos-full --no-link`
Expected: PASS

- [ ] **Step 3: Re-run the migration search to prove the old direction is gone from live surfaces**

Run:

```bash
rg -n "headscale|tailscale|tailnet|tailscaled" core tests docs README.md flake.nix
```

Expected: no hits in live implementation surfaces, or only historical spec/plan documents explicitly kept for context.

- [ ] **Step 4: Commit**

```bash
git add core tests docs README.md flake.nix
git commit -m "Finish the NetBird bootstrap pivot"
```

## Spec Coverage Check

- Managed NetBird service instead of self-hosting: covered by Tasks 1, 2, and 5.
- Setup-key file path at install time: covered by Task 3.
- Bootstrap public SSH fallback only: covered by Tasks 3, 5, and 6.
- Dark steady state with NetBird plus KVM: covered by Tasks 2, 3, 5, and 6.
- No domain required for default install story: covered by Task 5.
- Hard pivot away from Headscale/Tailscale: covered by Tasks 1, 4, 5, and 6.

## Self-Review Notes

- Placeholder scan: each task names explicit files, commands, and expected verification outcomes.
- Type consistency: this plan consistently uses `nixpi.netbird.enable`, `nixpi.netbird.setupKeyFile`, `nixpi.netbird.clientName`, and `nixpi.netbird.managementUrl`.
- Scope check: the plan stays focused on managed NetBird client bootstrap for VPS installs and does not broaden into generic provider abstractions or self-hosted control-plane work.
