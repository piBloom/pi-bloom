# No-NetBird SSH Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove NetBird from active NixPI host policy and replace it with key-only SSH that is restricted to explicit admin CIDRs during both bootstrap and steady state.

**Architecture:** Keep the OVH base profile plain and minimal, but make NixPI’s own network module enforce a single transparent security model: SSH stays available without VPN overlays, keys are required everywhere, and any public exposure is source-restricted with fail-closed assertions. The work breaks into four bounded areas: option surface, network policy, tests/integration flow, and docs/test registry cleanup.

**Tech Stack:** NixOS modules, Nix firewall rules, Bash bootstrap/deploy scripts, Vitest, NixOS VM tests, Markdown docs

---

### Task 1: Lock The New Security Contract In Tests First

**Files:**
- Modify: `tests/nixos/nixpi-options-validation.nix`
- Modify: `tests/nixos/nixpi-security.nix`
- Modify: `tests/integration/nixpi-deploy-ovh.test.ts`
- Modify: `tests/os/broker.test.ts`

- [ ] **Step 1: Replace NetBird option assertions with SSH CIDR option assertions in `tests/nixos/nixpi-options-validation.nix`**

```nix
environment.etc = {
  "nixpi-tests/ssh-password-auth".text =
    if config.services.openssh.settings.PasswordAuthentication then "yes" else "no";
  "nixpi-tests/has-ssh-cidr-option".text =
    if lib.hasAttrByPath [ "nixpi" "security" "ssh" "allowedSourceCIDRs" ] options then "yes" else "no";
  "nixpi-tests/ssh-source-cidrs".text =
    builtins.concatStringsSep "," config.nixpi.security.ssh.allowedSourceCIDRs;
};

nixpi = {
  security = {
    fail2ban.enable = false;
    ssh = {
      passwordAuthentication = true;
      allowedSourceCIDRs = [
        "198.51.100.10/32"
        "2001:db8::/48"
      ];
    };
  };
};
```

- [ ] **Step 2: Run the option validation test and confirm it fails on the missing option**

Run: `nix build .#checks.x86_64-linux.nixpi-options-validation --no-link`
Expected: FAIL with a missing `allowedSourceCIDRs` option or stale NetBird assertions.

- [ ] **Step 3: Rewrite the NixOS security test to model allowlisted public SSH instead of NetBird-only SSH**

```nix
nixpi = {
  primaryUser = username;
  security = {
    enforceServiceFirewall = true;
    ssh.allowedSourceCIDRs = [ "192.0.2.10/32" ];
  };
  bootstrap.enable = bootstrapEnable;
  bootstrap.ssh.enable = sshEnable;
  bootstrap.temporaryAdmin.enable = temporaryAdminEnable;
};

bootstrap.succeed("sshd -T | grep -qx 'passwordauthentication no'")
steady.succeed("sshd -T | grep -qx 'passwordauthentication no'")
steady.fail("nft list ruleset | grep -q 'tcp dport 22 accept$'")
steady.succeed("nft list ruleset | grep -q '192.0.2.10/32.*tcp dport 22.*accept'")
```

- [ ] **Step 4: Run the security NixOS test and confirm it fails before implementation**

Run: `nix build .#checks.x86_64-linux.nixpi-security --no-link`
Expected: FAIL because current network policy still keys off `nixpi.netbird` and permits password auth in some paths.

- [ ] **Step 5: Update integration/unit tests that still encode NetBird as active behavior**

```ts
const baseConfig: BrokerConfig = {
  socketPath: "/run/nixpi-broker/broker.sock",
  elevationPath: "/var/lib/nixpi/broker/elevation.json",
  brokerStateDir: "/var/lib/nixpi/broker",
  primaryUser: "tester",
  defaultAutonomy: "maintain",
  elevationDuration: "30m",
  osUpdateEnable: true,
  allowedUnits: ["nixpi-update.service"],
  defaultFlake: "/etc/nixos#nixos",
};

expect(result.stdout).not.toContain("nixpi.netbird");
expect(result.stdout).not.toContain("netbird");
```

- [ ] **Step 6: Run the targeted JS tests and confirm the expected red state**

Run: `npm run test -- tests/integration/nixpi-deploy-ovh.test.ts tests/os/broker.test.ts`
Expected: FAIL where fixtures still expect NetBird-backed behavior.

- [ ] **Step 7: Commit the test-first baseline**

```bash
git add tests/nixos/nixpi-options-validation.nix tests/nixos/nixpi-security.nix tests/integration/nixpi-deploy-ovh.test.ts tests/os/broker.test.ts
git commit -m "Define the no-NetBird SSH hardening contract in tests

Constraint: The repository must stop treating NetBird as the default admin boundary
Rejected: Defer test updates until after module edits | hides security regressions during refactor
Confidence: high
Scope-risk: moderate
Directive: Keep the CIDR allowlist assertions aligned with the active module surface
Tested: Targeted test updates written
Not-tested: Full repository test suite"
```

### Task 2: Replace The NetBird Option Surface With SSH Source CIDRs

**Files:**
- Modify: `core/os/modules/options/security.nix`
- Modify: `core/os/modules/options.nix`
- Delete: `core/os/modules/options/netbird.nix`

- [ ] **Step 1: Add the new SSH CIDR option in `core/os/modules/options/security.nix`**

```nix
ssh.allowedSourceCIDRs = lib.mkOption {
  type = lib.types.listOf lib.types.str;
  default = [ ];
  example = [
    "198.51.100.10/32"
    "2001:db8::/48"
  ];
  description = ''
    Source CIDRs allowed to reach the public SSH service. When SSH is
    exposed on the public interface, this list must be non-empty.
  '';
};
```

- [ ] **Step 2: Run the option validation test to verify the new option exists**

Run: `nix build .#checks.x86_64-linux.nixpi-options-validation --no-link`
Expected: still FAIL, but now on stale NetBird imports or runtime expectations instead of a missing option.

- [ ] **Step 3: Remove the NetBird option import from `core/os/modules/options.nix`**

```nix
imports = [
  ./options/core.nix
  ./options/bootstrap.nix
  ./options/security.nix
  ./options/agent.nix
  (lib.mkRenamedOptionModule [ "nixpi" "bootstrap" "keepSshAfterSetup" ] [ "nixpi" "bootstrap" "ssh" "enable" ])
  (lib.mkRemovedOptionModule [ "nixpi" "install" "enable" ] installFinalizeRemoved)
  (lib.mkRemovedOptionModule [ "nixpi" "install" "repoUrl" ] installFinalizeRemoved)
  (lib.mkRemovedOptionModule [ "nixpi" "install" "repoBranch" ] installFinalizeRemoved)
];
```

- [ ] **Step 4: Delete the repository-level NetBird option module**

Run: `git rm core/os/modules/options/netbird.nix`
Expected: file removed from the option surface cleanly.

- [ ] **Step 5: Re-run the targeted option test**

Run: `nix build .#checks.x86_64-linux.nixpi-options-validation --no-link`
Expected: PASS for option presence, FAIL only if downstream modules still reference `config.nixpi.netbird`.

- [ ] **Step 6: Commit the option-surface change**

```bash
git add core/os/modules/options/security.nix core/os/modules/options.nix
git commit -m "Remove NetBird from the active option surface

Constraint: The new remote-admin model must be plain SSH plus source allowlisting
Rejected: Keep nixpi.netbird as deprecated alias | prolongs an admin model we are removing
Confidence: high
Scope-risk: narrow
Directive: Add new security options under nixpi.security.ssh rather than a parallel top-level namespace
Tested: nixpi-options-validation
Not-tested: Network behavior"
```

### Task 3: Rewire The Core Network Module Around Public SSH Allowlisting

**Files:**
- Modify: `core/os/modules/network.nix`
- Modify: `core/os/hosts/ovh-base.nix`

- [ ] **Step 1: Remove NetBird-dependent branching and derive exposure from bootstrap state plus configured CIDRs**

```nix
let
  primaryUser = config.nixpi.primaryUser;
  securityCfg = config.nixpi.security;
  bootstrapCfg = config.nixpi.bootstrap;
  allowedSourceCIDRs = securityCfg.ssh.allowedSourceCIDRs;
  publicSshEnabled = bootstrapCfg.ssh.enable;
  sshAllowUsers =
    if securityCfg.ssh.allowUsers != [ ] then
      securityCfg.ssh.allowUsers
    else
      lib.optional (primaryUser != "") primaryUser;
in
```

- [ ] **Step 2: Add a fail-closed assertion for public SSH exposure without configured source CIDRs**

```nix
assertions = [
  {
    assertion = !bootstrapCfg.ssh.enable || allowedSourceCIDRs != [ ];
    message = "nixpi.security.ssh.allowedSourceCIDRs must be set when bootstrap SSH is enabled.";
  }
  {
    assertion = !config.services.openssh.enable || allowedSourceCIDRs != [ ];
    message = "nixpi.security.ssh.allowedSourceCIDRs must be set when public SSH is enabled.";
  }
];
```

- [ ] **Step 3: Make both bootstrap and steady-state SSH key-only and source-restricted**

```nix
services.openssh = {
  enable = bootstrapCfg.ssh.enable;
  openFirewall = false;
  settings = {
    AllowAgentForwarding = false;
    AllowTcpForwarding = false;
    ClientAliveCountMax = 2;
    ClientAliveInterval = 300;
    LoginGraceTime = 30;
    MaxAuthTries = 3;
    PasswordAuthentication = false;
    PubkeyAuthentication = "yes";
    PermitRootLogin = if bootstrapCfg.enable then "no" else "no";
    X11Forwarding = false;
  };
  extraConfig = lib.optionalString (sshAllowUsers != [ ]) ''
    AllowUsers ${lib.concatStringsSep " " sshAllowUsers}
  '';
};
```

- [ ] **Step 4: Replace interface-scoped port openings with source-aware firewall rules**

```nix
networking.firewall = {
  enable = true;
  allowedTCPPorts = [ ];
  extraInputRules = lib.concatMapStringsSep "\n" (cidr: ''
    ip saddr ${cidr} tcp dport 22 accept
  '') (lib.filter (cidr: !(lib.hasInfix ":" cidr)) allowedSourceCIDRs)
  + "\n"
  + lib.concatMapStringsSep "\n" (cidr: ''
    ip6 saddr ${cidr} tcp dport 22 accept
  '') (lib.filter (cidr: lib.hasInfix ":" cidr) allowedSourceCIDRs);
};
```

- [ ] **Step 5: Remove the NetBird service/package wiring from `core/os/modules/network.nix`**

```nix
# Delete:
#   netbirdCfg = config.nixpi.netbird;
#   services.resolved.enable = lib.mkIf netbirdCfg.enable true;
#   services.netbird.clients.wt0 = ...
#   environment.systemPackages = lib.optionals netbirdCfg.enable [ pkgs.netbird ];
```

- [ ] **Step 6: Keep `core/os/hosts/ovh-base.nix` minimal and explicitly key-only**

```nix
services.openssh = {
  enable = true;
  settings = {
    PasswordAuthentication = false;
    PermitRootLogin = "prohibit-password";
    PubkeyAuthentication = "yes";
  };
};
```

- [ ] **Step 7: Run the focused NixOS verification**

Run: `nix build .#checks.x86_64-linux.nixpi-security --no-link`
Expected: PASS, with SSH key-only and CIDR-gated behavior replacing NetBird.

- [ ] **Step 8: Commit the network-policy rewrite**

```bash
git add core/os/modules/network.nix core/os/hosts/ovh-base.nix
git commit -m "Replace overlay-admin gating with CIDR-restricted SSH

Constraint: Recovery is console-only, so remote SSH exposure must fail closed
Rejected: Keep password auth during bootstrap | conflicts with the approved security policy
Confidence: medium
Scope-risk: broad
Directive: Do not reintroduce unconditional port 22 exposure in the NixPI module layer
Tested: nixpi-security
Not-tested: Full OVH end-to-end deploy"
```

### Task 4: Update Bootstrap And Deploy Integration To Feed The New Security Inputs

**Files:**
- Modify: `core/scripts/nixpi-bootstrap-host.sh`
- Modify: `core/scripts/nixpi-deploy-ovh.sh`
- Modify: `tests/integration/nixpi-bootstrap-host.test.ts`
- Modify: `tests/integration/nixpi-deploy-ovh.test.ts`

- [ ] **Step 1: Extend `nixpi-bootstrap-host.sh` to accept CIDR allowlists**

```bash
Usage: nixpi-bootstrap-host --primary-user USER [--hostname HOSTNAME] [--timezone TZ] [--keyboard LAYOUT] [--nixpi-input FLAKE_REF] [--authorized-key KEY | --authorized-key-file PATH] [--ssh-allowed-cidr CIDR ...] [--force]

ssh_allowed_cidrs=()

case "$1" in
  --ssh-allowed-cidr)
    ssh_allowed_cidrs+=("${2:?missing CIDR}")
    shift 2
    ;;
esac
```

- [ ] **Step 2: Write the allowlist into the generated host module**

```nix
  nixpi.security.ssh.allowedSourceCIDRs = [
    "198.51.100.10/32"
    "2001:db8::/48"
  ];
```

- [ ] **Step 3: Add failing integration coverage for the new bootstrap host input**

```ts
const result = await runBootstrap([
  "--primary-user",
  "alex",
  "--authorized-key",
  "ssh-ed25519 AAAATESTKEY user@test",
  "--ssh-allowed-cidr",
  "198.51.100.10/32",
]);

expect(result.readEtcNixosFile("nixpi-host.nix")).toContain('nixpi.security.ssh.allowedSourceCIDRs = [');
expect(result.readEtcNixosFile("nixpi-host.nix")).toContain('"198.51.100.10/32"');
```

- [ ] **Step 4: Keep `nixpi-deploy-ovh.sh` plain and reject any attempt to smuggle old NetBird flags back in**

```bash
--bootstrap-user|--bootstrap-user=*|--bootstrap-password-hash|--bootstrap-password-hash=*|--netbird-setup-key-file|--netbird-setup-key-file=*)
  usage >&2
  printf 'Unsupported legacy option: %s. Install the plain ovh-base system, then run nixpi-bootstrap-host after first boot.\n' "${1%%=*}" >&2
  exit 1
  ;;
```

- [ ] **Step 5: Run the targeted integration tests**

Run: `npm run test -- tests/integration/nixpi-bootstrap-host.test.ts tests/integration/nixpi-deploy-ovh.test.ts`
Expected: PASS with the generated host file containing `allowedSourceCIDRs` and no NetBird output.

- [ ] **Step 6: Commit the integration flow update**

```bash
git add core/scripts/nixpi-bootstrap-host.sh core/scripts/nixpi-deploy-ovh.sh tests/integration/nixpi-bootstrap-host.test.ts tests/integration/nixpi-deploy-ovh.test.ts
git commit -m "Feed SSH source allowlists into the OVH bootstrap flow

Constraint: The OVH deploy helper must remain a plain base install path
Rejected: Push SSH CIDR inputs into nixpi-deploy-ovh | mixes base install and NixPI bootstrap responsibilities
Confidence: high
Scope-risk: moderate
Directive: Keep SSH security inputs owned by nixpi-bootstrap-host after first boot
Tested: nixpi-bootstrap-host and nixpi-deploy-ovh integration tests
Not-tested: Live OVH rescue install"
```

### Task 5: Remove NetBird From Active Test Registry And Operator Docs

**Files:**
- Modify: `tests/nixos/default.nix`
- Modify: `README.md`
- Modify: `docs/install.md`
- Modify: `docs/reference/infrastructure.md`
- Modify: `docs/reference/service-architecture.md`
- Modify: `docs/architecture/runtime-flows.md`
- Modify: `docs/operations/first-boot-setup.md`
- Modify: `docs/operations/index.md`
- Modify: `docs/operations/live-testing.md`
- Modify: `docs/operations/ovh-rescue-deploy.md`
- Modify: `docs/operations/quick-deploy.md`

- [ ] **Step 1: Remove the active NetBird NixOS test registration**

```nix
tests = {
  nixpi-bootstrap-host = runTest ./nixpi-bootstrap-host.nix;
  nixpi-firstboot = runTest ./nixpi-firstboot.nix;
  nixpi-system-flake = runTest ./nixpi-system-flake.nix;
  nixpi-runtime = runTest ./nixpi-runtime.nix;
  nixpi-network = runTest ./nixpi-network.nix;
  nixpi-e2e = runTest ./nixpi-e2e.nix;
  nixpi-security = runTest ./nixpi-security.nix;
  nixpi-modular-services = runTest ./nixpi-modular-services.nix;
  nixpi-post-setup-lockdown = runTest ./nixpi-post-setup-lockdown.nix;
  nixpi-broker = runTest ./nixpi-broker.nix;
  nixpi-update = runTest ./nixpi-update.nix;
  nixpi-options-validation = runTest ./nixpi-options-validation.nix;
};
```

- [ ] **Step 2: Rewrite operator docs from “validate NetBird” to “validate hardened SSH policy”**

```md
Check SSH policy after bootstrap:

```bash
systemctl status sshd.service
sshd -T | grep -E 'passwordauthentication|permitrootlogin|allowtcpforwarding|allowagentforwarding'
sudo nft list ruleset | grep 'dport 22'
```

Recovery note: if the SSH allowlist is wrong, use OVH console or rescue mode. There is no remote VPN fallback.
```

- [ ] **Step 3: Run repo-wide search and remove active NetBird references outside historical plan/spec material**

Run: `rg -n "netbird-wt0|nixpi\\.netbird|services\\.netbird|NetBird" README.md docs core tests`
Expected: only historical docs/specs/plans remain, or zero active references in README/docs/core/tests.

- [ ] **Step 4: Run lightweight verification for docs plus test registry**

Run: `npm run test -- tests/os/broker.test.ts`
Expected: PASS with no stale NetBird allowlist assumptions.

- [ ] **Step 5: Commit the documentation cleanup**

```bash
git add tests/nixos/default.nix README.md docs/install.md docs/reference/infrastructure.md docs/reference/service-architecture.md docs/architecture/runtime-flows.md docs/operations/first-boot-setup.md docs/operations/index.md docs/operations/live-testing.md docs/operations/ovh-rescue-deploy.md docs/operations/quick-deploy.md
git commit -m "Document plain SSH hardening as the supported admin model

Constraint: The operator docs must match the actual no-NetBird deployment path
Rejected: Leave NetBird checks as optional examples | keeps misleading active runbooks in place
Confidence: medium
Scope-risk: moderate
Directive: Treat OVH console/rescue as the only documented recovery path
Tested: Broker unit test and active-reference search
Not-tested: Full docs site render"
```

### Task 6: Full Verification And Final Review

**Files:**
- Modify: none
- Verify: `core/os/modules/network.nix`
- Verify: `core/scripts/nixpi-bootstrap-host.sh`
- Verify: `tests/nixos/nixpi-security.nix`
- Verify: `README.md`

- [ ] **Step 1: Run the focused verification suite**

Run: `npm run test -- tests/integration/nixpi-bootstrap-host.test.ts tests/integration/nixpi-deploy-ovh.test.ts tests/os/broker.test.ts`
Expected: PASS

- [ ] **Step 2: Run the NixOS checks that prove the security contract**

Run: `nix build .#checks.x86_64-linux.nixpi-options-validation --no-link`
Expected: PASS

Run: `nix build .#checks.x86_64-linux.nixpi-security --no-link`
Expected: PASS

- [ ] **Step 3: Run repository hygiene checks**

Run: `npm run check`
Expected: PASS with no formatter or lint regressions.

- [ ] **Step 4: Perform final active-reference scans**

Run: `rg -n "nixpi\\.netbird|services\\.netbird|netbird-wt0|WireGuard|Headscale|Tailscale" README.md docs core tests`
Expected: No matches in active code/docs except intentionally historical files under `docs/superpowers/` or `internal/specs/`.

- [ ] **Step 5: Inspect the final diff before handoff**

Run: `git diff --stat`
Expected: Changes concentrated in the option surface, network module, tests, bootstrap helper, and docs listed above.

- [ ] **Step 6: Commit the verification checkpoint if needed**

```bash
git commit --allow-empty -m "Record verification for the no-NetBird SSH hardening change

Constraint: Security claims must be backed by concrete test and build evidence
Rejected: Finalize after only unit tests | insufficient for a network-policy rewrite
Confidence: high
Scope-risk: narrow
Directive: Re-run the NixOS security checks whenever SSH exposure policy changes
Tested: npm run test, nixpi-options-validation, nixpi-security, npm run check
Not-tested: Live OVH deployment"
```

## Spec Coverage Check

- Remove NetBird option surface: covered by Task 2.
- Remove NetBird service/package wiring: covered by Task 3.
- Key-only bootstrap and steady state: covered by Tasks 1, 3, and 4.
- Require explicit admin CIDRs and fail closed: covered by Tasks 1, 2, 3, and 4.
- Console/rescue only recovery path: covered by Task 5.
- Update tests and docs to stop expecting NetBird: covered by Tasks 1 and 5.

## Placeholder Scan

No `TBD`, `TODO`, or “implement later” placeholders remain. Each task names exact files, concrete commands, and the expected failures or passes.

## Type Consistency Check

- The new option name is consistently `nixpi.security.ssh.allowedSourceCIDRs`.
- The plan keeps `nixpi.security.ssh.allowUsers` and `nixpi.security.ssh.passwordAuthentication` unchanged.
- The bootstrap helper writes `nixpi.security.ssh.allowedSourceCIDRs` into `nixpi-host.nix`, matching the module option added in Task 2.
