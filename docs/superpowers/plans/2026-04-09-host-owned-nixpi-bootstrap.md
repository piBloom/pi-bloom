# Host-Owned NixPI Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current direct-final-install OVH model with a clean-break host-owned `/etc/nixos` bootstrap flow, remove repo-profile day-2 rebuild semantics, and make OVH just a plain NixOS base install plus shared NixPI bootstrap.

**Architecture:** Add one shared `nixpi-bootstrap-host` entrypoint that runs on an already-installed NixOS machine, writes narrow `/etc/nixos` helper files, and either generates a minimal host flake or prints exact manual integration steps for pre-existing flake hosts. Replace `ovh-vps` with `ovh-base`, retarget `nixpi-deploy-ovh` to plain base installation only, and remove `nixpi-rebuild-pull` / `nixpi-reinstall-ovh` plus all docs/tests that encode the old direct-final-install architecture.

**Tech Stack:** Nix flakes, NixOS modules, `nixos-anywhere`, `disko`, Bash, Vitest, NixOS VM tests, Markdown docs, existing `core/lib/exec.ts`-style script tests.

---

## File Structure

### Create

- `core/scripts/nixpi-bootstrap-host.sh` — shared host-local bootstrap entrypoint for already-installed NixOS systems.
- `core/os/pkgs/nixpi-bootstrap-host/default.nix` — package exposing the bootstrap script via `nix run`.
- `core/os/hosts/ovh-base.nix` — plain OVH-compatible base NixOS install profile with no NixPI layer.
- `tests/integration/nixpi-bootstrap-host.test.ts` — deterministic harness for bootstrap script behavior on classic and existing-flake hosts.
- `tests/nixos/nixpi-bootstrap-host.nix` — NixOS VM test that exercises the generated `/etc/nixos` bootstrap files.

### Modify

- `flake.nix` — expose `nixpi-bootstrap-host`, remove `nixpi-rebuild-pull` / `nixpi-reinstall-ovh`, swap `ovh-vps` for `ovh-base`, register the new NixOS test and app.
- `core/scripts/nixpi-deploy-ovh.sh` — narrow to base install arguments only and default to `.#ovh-base`.
- `core/scripts/nixpi-ovh-common.sh` — remove final-host bootstrap overrides and build the deploy flake from `ovh-base`.
- `core/scripts/nixpi-rebuild.sh` — keep as the only supported rebuild wrapper.
- `core/os/modules/tooling.nix` — drop `nixpi-rebuild-pull` from the installed tool bundle.
- `tests/integration/standards-guard.test.ts` — invert the repo/docs guards to enforce the host-owned model and the absence of legacy lanes.
- `tests/integration/nixpi-deploy-ovh.test.ts` — update the deploy wrapper contract from final `ovh-vps` install to plain `ovh-base` install.
- `tests/integration/ovh-vps-config.test.ts` — replace with `ovh-base` config assertions.
- `tests/nixos/default.nix` — register the new bootstrap VM test and remove no-longer-valid aliases if needed.
- `README.md`
- `docs/install.md`
- `docs/operations/quick-deploy.md`
- `docs/operations/ovh-rescue-deploy.md`
- `docs/operations/first-boot-setup.md`
- `docs/operations/live-testing.md`
- `docs/architecture/runtime-flows.md`
- `docs/reference/infrastructure.md`
- `core/pi/persona/SKILL.md`

### Delete

- `core/scripts/nixpi-rebuild-pull.sh`
- `core/scripts/nixpi-reinstall-ovh.sh`
- `core/os/pkgs/nixpi-rebuild-pull/default.nix`
- `core/os/pkgs/nixpi-reinstall-ovh/default.nix`
- `core/os/hosts/ovh-vps.nix`
- `tests/integration/nixpi-reinstall-ovh.test.ts`

### Verify

- `npm test -- --runInBand tests/integration/standards-guard.test.ts`
- `npm test -- --runInBand tests/integration/nixpi-bootstrap-host.test.ts`
- `npm test -- --runInBand tests/integration/nixpi-deploy-ovh.test.ts`
- `nix eval .#nixosConfigurations.ovh-base.config.networking.hostName --json`
- `nix build .#packages.x86_64-linux.nixpi-bootstrap-host --no-link`
- `nix build .#packages.x86_64-linux.nixpi-deploy-ovh --no-link`
- `nix build .#checks.x86_64-linux.nixpi-bootstrap-host --no-link -L`
- `npm run check`
- `npm test`

## Task 1: Lock the clean-break contract in tests first

**Files:**
- Modify: `tests/integration/standards-guard.test.ts`
- Create: `tests/integration/nixpi-bootstrap-host.test.ts`
- Test: `tests/integration/standards-guard.test.ts`
- Test: `tests/integration/nixpi-bootstrap-host.test.ts`

- [ ] **Step 1: Add failing standards guards for the host-owned install story**

```ts
it("documents the host-owned bootstrap install story and rejects legacy lanes", () => {
	const docs = readDocs();
	const readme = docs[readmePath];
	const installDoc = docs[installDocPath];
	const quickDeployDoc = docs[quickDeployDocPath];
	const firstBootDoc = docs[firstBootDocPath];
	const runtimeFlowsDoc = docs[runtimeFlowsDocPath];
	const liveTestingDoc = docs[liveTestingDocPath];
	const infrastructureDoc = readFileSync(infrastructureDocPath, "utf8");
	const personaSkill = readFileSync(personaSkillPath, "utf8");

	expect(readme).toContain("plain OVH-compatible NixOS base system");
	expect(readme).toContain("nixpi-bootstrap-host");
	expect(readme).toContain("`/etc/nixos` is the running host's source of truth");
	expect(readme).not.toContain("final host configuration installed directly by `nixos-anywhere`");
	expect(readme).not.toContain("nixpi-rebuild-pull");
	expect(readme).not.toContain("/srv/nixpi");

	expect(installDoc).toContain("install a plain NixOS base");
	expect(installDoc).toContain("run `nixpi-bootstrap-host` on the machine");
	expect(installDoc).not.toContain("final host configuration directly");
	expect(installDoc).not.toContain("No first-boot repo clone or generated flake step");

	expect(quickDeployDoc).toContain("install the `ovh-base` system");
	expect(quickDeployDoc).toContain("bootstrap NixPI after first boot");
	expect(quickDeployDoc).not.toContain("final `ovh-vps` host configuration directly");

	expect(firstBootDoc).toContain("run `nixpi-bootstrap-host`");
	expect(firstBootDoc).not.toContain("nixpi-rebuild-pull");
	expect(firstBootDoc).not.toContain("<checkout-path>#ovh-vps");

	expect(runtimeFlowsDoc).toContain("plain base system");
	expect(runtimeFlowsDoc).toContain("bootstrap writes narrow `/etc/nixos` helper files");
	expect(runtimeFlowsDoc).not.toContain("final host configuration directly");

	expect(liveTestingDoc).toContain("base install then bootstrap");
	expect(liveTestingDoc).not.toContain("final `ovh-vps` host configuration directly");

	expect(infrastructureDoc).toContain("nixpi-bootstrap-host");
	expect(infrastructureDoc).not.toContain("nixpi-rebuild-pull [branch]");
	expect(infrastructureDoc).not.toContain("/srv/nixpi");

	expect(personaSkill).toContain("Canonical rebuild path: `sudo nixpi-rebuild`.");
	expect(personaSkill).not.toContain("nixpi-rebuild-pull");
});
```

- [ ] **Step 2: Add failing topology guards for the new package/profile set**

```ts
it("keeps only the host-owned bootstrap lane wired into the repo", () => {
	const flake = readFileSync(path.join(repoRoot, "flake.nix"), "utf8");

	expect(flake).toContain("nixpi-bootstrap-host");
	expect(flake).toContain("ovh-base = mkConfiguredStableSystem");
	expect(flake).toContain("./core/os/hosts/ovh-base.nix");

	expect(existsSync(path.join(repoRoot, "core/scripts/nixpi-bootstrap-host.sh"))).toBe(true);
	expect(existsSync(path.join(repoRoot, "core/os/hosts/ovh-base.nix"))).toBe(true);

	expect(flake).not.toContain("nixpi-rebuild-pull");
	expect(flake).not.toContain("nixpi-reinstall-ovh");
	expect(flake).not.toContain("ovh-vps = mkConfiguredStableSystem");
	expect(existsSync(path.join(repoRoot, "core/scripts/nixpi-rebuild-pull.sh"))).toBe(false);
	expect(existsSync(path.join(repoRoot, "core/scripts/nixpi-reinstall-ovh.sh"))).toBe(false);
});
```

- [ ] **Step 3: Create a failing bootstrap script harness test**

```ts
describe("nixpi-bootstrap-host.sh", () => {
	it("generates a minimal host flake and helper files on a classic /etc/nixos tree", async () => {
		const result = await runBootstrap([
			"--primary-user",
			"alex",
			"--hostname",
			"bloom-eu-1",
			"--timezone",
			"Europe/Bucharest",
			"--keyboard",
			"us",
		]);

		expect(result.exitCode).toBe(0);
		expect(result.readFile("etc/nixos/flake.nix")).toContain('inputs.nixpi.url = "github:alexradunet/nixpi"');
		expect(result.readFile("etc/nixos/flake.nix")).toContain("./nixpi-integration.nix");
		expect(result.readFile("etc/nixos/nixpi-integration.nix")).toContain("nixpi.nixosModules.nixpi");
		expect(result.readFile("etc/nixos/nixpi-host.nix")).toContain('nixpi.primaryUser = "alex";');
		expect(result.rebuildArgs()).toEqual(["switch", "--flake", "/etc/nixos#nixos", "--impure"]);
	});
});
```

- [ ] **Step 4: Add the failing existing-flake-host guard**

```ts
it("writes helper files but refuses to rewrite an existing flake host", async () => {
	const result = await runBootstrap(["--primary-user", "alex"], {
		preseedFlake: true,
	});

	expect(result.exitCode).toBe(0);
	expect(result.readFile("etc/nixos/nixpi-integration.nix")).toContain("nixpi.nixosModules.nixpi");
	expect(result.stdout).toContain("Manual integration required");
	expect(result.stdout).toContain("inputs.nixpi.url");
	expect(result.stdout).toContain("./nixpi-integration.nix");
	expect(result.rebuildArgs()).toEqual([]);
});
```

- [ ] **Step 5: Run the focused tests to verify they fail**

Run: `npm test -- --runInBand tests/integration/standards-guard.test.ts tests/integration/nixpi-bootstrap-host.test.ts`
Expected: FAIL because the new files, package wiring, and bootstrap behavior do not exist yet.

- [ ] **Step 6: Commit the red tests**

```bash
git add tests/integration/standards-guard.test.ts tests/integration/nixpi-bootstrap-host.test.ts
git commit -F- <<'EOF'
Define the host-owned bootstrap contract in regression tests

The install story is switching to a clean-break `/etc/nixos`-owned
model, so the repo needs guards that reject direct-final-install OVH
language and repo-profile rebuild paths before implementation starts.

Constraint: No backward compatibility with the direct `ovh-vps` lane
Rejected: Preserve old guards and add parallel ones | would keep conflicting product boundaries alive
Confidence: high
Scope-risk: narrow
Directive: Update these guards first if the install story changes again
Tested: `npm test -- --runInBand tests/integration/standards-guard.test.ts tests/integration/nixpi-bootstrap-host.test.ts` (expected fail)
Not-tested: Full test suite
EOF
```

## Task 2: Implement `nixpi-bootstrap-host` and its VM coverage

**Files:**
- Create: `core/scripts/nixpi-bootstrap-host.sh`
- Create: `core/os/pkgs/nixpi-bootstrap-host/default.nix`
- Create: `tests/nixos/nixpi-bootstrap-host.nix`
- Modify: `tests/nixos/default.nix`
- Modify: `flake.nix`
- Test: `tests/integration/nixpi-bootstrap-host.test.ts`
- Test: `tests/nixos/nixpi-bootstrap-host.nix`

- [ ] **Step 1: Implement the bootstrap script shell contract**

```bash
#!/usr/bin/env bash
set -euo pipefail

usage() {
	cat <<'EOF_USAGE'
Usage: nixpi-bootstrap-host --primary-user USER [--hostname HOSTNAME] [--timezone TZ] [--keyboard LAYOUT] [--nixpi-input FLAKE_REF]

Bootstrap NixPI onto an already-installed NixOS host by writing narrow /etc/nixos helper files.
If /etc/nixos/flake.nix does not exist, a minimal host flake is generated automatically.
If /etc/nixos/flake.nix already exists, helper files are written and exact manual integration instructions are printed.
EOF_USAGE
}

etc_nixos_dir="${NIXPI_BOOTSTRAP_ROOT:-/etc/nixos}"
nixos_rebuild_bin="${NIXPI_NIXOS_REBUILD:-nixos-rebuild}"
primary_user=""
hostname="nixos"
timezone="UTC"
keyboard="us"
nixpi_input="github:alexradunet/nixpi"
```

- [ ] **Step 2: Write the generated helper files exactly**

```bash
cat > "${etc_nixos_dir}/nixpi-host.nix" <<EOF_HOST
{ ... }:
{
  networking.hostName = "${hostname}";
  nixpi.primaryUser = "${primary_user}";
  nixpi.timezone = "${timezone}";
  nixpi.keyboard = "${keyboard}";
}
EOF_HOST

cat > "${etc_nixos_dir}/nixpi-integration.nix" <<'EOF_INTEGRATION'
{ nixpi, ... }:
{
  imports = [
    nixpi.nixosModules.nixpi
    ./nixpi-host.nix
  ];
}
EOF_INTEGRATION
```

- [ ] **Step 3: Generate the minimal flake only for classic hosts**

```bash
if [[ ! -f "${etc_nixos_dir}/flake.nix" ]]; then
	cat > "${etc_nixos_dir}/flake.nix" <<EOF_FLAKE
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";
    nixpi.url = "${nixpi_input}";
    nixpi.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = { nixpkgs, nixpi, ... }: {
    nixosConfigurations.nixos = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      specialArgs = { inherit nixpi; };
      modules = [
        ./configuration.nix
        ./nixpi-integration.nix
      ] ++ (if builtins.pathExists ./hardware-configuration.nix then [ ./hardware-configuration.nix ] else []);
    };
  };
}
EOF_FLAKE

	exec "${nixos_rebuild_bin}" switch --flake /etc/nixos#nixos --impure
fi
```

- [ ] **Step 4: Print exact manual instructions for pre-existing flake hosts**

```bash
cat <<'EOF_MANUAL'
Manual integration required: /etc/nixos/flake.nix already exists.

1. Add the NixPI input:
   inputs.nixpi.url = "github:alexradunet/nixpi";
   inputs.nixpi.inputs.nixpkgs.follows = "nixpkgs";

2. Ensure your nixosSystem passes the NixPI input:
   specialArgs = { inherit nixpi; };

3. Add the generated helper module to your host's modules list:
   ./nixpi-integration.nix

4. Rebuild manually:
   sudo nixos-rebuild switch --flake /etc/nixos#nixos --impure
EOF_MANUAL
```

- [ ] **Step 5: Package and expose the script in `flake.nix`**

```nix
# core/os/pkgs/nixpi-bootstrap-host/default.nix
{ pkgs, makeWrapper }:

pkgs.stdenvNoCC.mkDerivation {
  pname = "nixpi-bootstrap-host";
  version = "0.1.0";
  dontUnpack = true;
  nativeBuildInputs = [ makeWrapper ];

  installPhase = ''
    mkdir -p "$out/bin" "$out/share/nixpi-bootstrap-host"
    install -m 0755 ${../../../scripts/nixpi-bootstrap-host.sh} "$out/share/nixpi-bootstrap-host/nixpi-bootstrap-host.sh"
    makeWrapper ${pkgs.bash}/bin/bash "$out/bin/nixpi-bootstrap-host" \
      --prefix PATH : "${pkgs.lib.makeBinPath [ pkgs.coreutils pkgs.nix ]}" \
      --add-flags "$out/share/nixpi-bootstrap-host/nixpi-bootstrap-host.sh"
  '';
}
```

```nix
# flake.nix package/app snippets
nixpi-bootstrap-host = pkgs.callPackage ./core/os/pkgs/nixpi-bootstrap-host { };
```

```nix
nixpi-bootstrap-host = {
  type = "app";
  program = "${self.packages.${system}.nixpi-bootstrap-host}/bin/nixpi-bootstrap-host";
};
```

- [ ] **Step 6: Register a VM test that checks the generated files**

```nix
# tests/nixos/nixpi-bootstrap-host.nix
{ pkgs, ... }:
{
  name = "nixpi-bootstrap-host";

  nodes.machine = { ... }: {
    environment.systemPackages = [ pkgs.git pkgs.nix ];
  };

  testScript = ''
    machine.start()
    machine.wait_for_unit("multi-user.target")
    machine.succeed("mkdir -p /etc/nixos")
    machine.succeed("cat > /etc/nixos/configuration.nix <<'EOF'\n{ ... }: { system.stateVersion = \"25.05\"; }\nEOF")
    machine.succeed("${pkgs.writeShellScript "run-bootstrap" ''
      ${pkgs.bash}/bin/bash ${./../../core/scripts/nixpi-bootstrap-host.sh} --primary-user alex --hostname vm-host
    ''}")
    machine.succeed("grep -q 'nixpi.primaryUser = \"alex\";' /etc/nixos/nixpi-host.nix")
    machine.succeed("grep -q 'nixpi.nixosModules.nixpi' /etc/nixos/nixpi-integration.nix")
  '';
}
```

- [ ] **Step 7: Run the focused tests until they pass**

Run: `npm test -- --runInBand tests/integration/nixpi-bootstrap-host.test.ts`
Expected: PASS

Run: `nix build .#packages.x86_64-linux.nixpi-bootstrap-host --no-link`
Expected: PASS

Run: `nix build .#checks.x86_64-linux.nixpi-bootstrap-host --no-link -L`
Expected: PASS

- [ ] **Step 8: Commit the bootstrap path**

```bash
git add core/scripts/nixpi-bootstrap-host.sh core/os/pkgs/nixpi-bootstrap-host/default.nix flake.nix tests/integration/nixpi-bootstrap-host.test.ts tests/nixos/default.nix tests/nixos/nixpi-bootstrap-host.nix
git commit -F- <<'EOF'
Add a host-owned NixPI bootstrap entrypoint

This introduces a single bootstrap path for already-installed NixOS
machines. Classic hosts get a generated minimal flake plus helper
files, while existing flake hosts get helper files and exact manual
integration instructions without any automatic rewriting.

Constraint: Existing flake hosts must not be auto-patched
Rejected: Rewrite custom host flakes automatically | unsafe and brittle against local structure
Confidence: high
Scope-risk: moderate
Directive: Keep bootstrap limited to helper-file generation and explicit rebuild instructions
Tested: `npm test -- --runInBand tests/integration/nixpi-bootstrap-host.test.ts`; `nix build .#packages.x86_64-linux.nixpi-bootstrap-host --no-link`; `nix build .#checks.x86_64-linux.nixpi-bootstrap-host --no-link -L`
Not-tested: Live host bootstrap on non-x86_64 hardware
EOF
```

## Task 3: Remove repo-profile day-2 rebuild semantics

**Files:**
- Delete: `core/scripts/nixpi-rebuild-pull.sh`
- Delete: `core/os/pkgs/nixpi-rebuild-pull/default.nix`
- Delete: `core/scripts/nixpi-reinstall-ovh.sh`
- Delete: `core/os/pkgs/nixpi-reinstall-ovh/default.nix`
- Delete: `tests/integration/nixpi-reinstall-ovh.test.ts`
- Modify: `flake.nix`
- Modify: `core/os/modules/tooling.nix`
- Test: `tests/integration/standards-guard.test.ts`

- [ ] **Step 1: Remove the legacy scripts and package exposure**

```bash
rm -f core/scripts/nixpi-rebuild-pull.sh
rm -f core/scripts/nixpi-reinstall-ovh.sh
rm -f core/os/pkgs/nixpi-rebuild-pull/default.nix
rm -f core/os/pkgs/nixpi-reinstall-ovh/default.nix
rm -f tests/integration/nixpi-reinstall-ovh.test.ts
```

- [ ] **Step 2: Drop package/app wiring from `flake.nix`**

```nix
# remove from packages
nixpi-rebuild-pull = pkgs.callPackage ./core/os/pkgs/nixpi-rebuild-pull { };
nixpi-reinstall-ovh = pkgs.callPackage ./core/os/pkgs/nixpi-reinstall-ovh {
  nixosAnywherePackage = nixos-anywhere.packages.${system}.nixos-anywhere;
};
```

```nix
# remove from apps
nixpi-reinstall-ovh = {
  type = "app";
  program = "${self.packages.${system}.nixpi-reinstall-ovh}/bin/nixpi-reinstall-ovh";
};
```

- [ ] **Step 3: Remove the tool from the installed package set**

```nix
let
  nixpiRebuild = pkgs.callPackage ../pkgs/nixpi-rebuild { };
in
{
  config.environment.systemPackages = with pkgs; [
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
    nixpiRebuild
  ]
  ++ lib.optionals config.nixpi.tooling.qemu.enable [ qemu OVMF ]
  ++ lib.optionals config.nixpi.security.fail2ban.enable [ pkgs.fail2ban ];
}
```

- [ ] **Step 4: Re-run the standards guard**

Run: `npm test -- --runInBand tests/integration/standards-guard.test.ts`
Expected: still FAIL, but no longer because of legacy file/package presence.

- [ ] **Step 5: Commit the clean-break removal**

```bash
git add flake.nix core/os/modules/tooling.nix
git rm core/scripts/nixpi-rebuild-pull.sh core/scripts/nixpi-reinstall-ovh.sh core/os/pkgs/nixpi-rebuild-pull/default.nix core/os/pkgs/nixpi-reinstall-ovh/default.nix tests/integration/nixpi-reinstall-ovh.test.ts
git commit -F- <<'EOF'
Remove legacy repo-driven rebuild and reinstall lanes

The host-owned model has one rebuild target: `/etc/nixos#nixos`.
Keeping repo-profile rebuild helpers or a second OVH reinstall wrapper
would preserve the exact architecture this migration is removing.

Constraint: No backward compatibility with repo-profile day-2 flows
Rejected: Keep `nixpi-rebuild-pull` as a deprecated alias | still teaches the wrong operational model
Confidence: high
Scope-risk: moderate
Directive: Do not reintroduce repo-profile rebuild paths without a new architecture review
Tested: `npm test -- --runInBand tests/integration/standards-guard.test.ts`
Not-tested: Full repo test suite
EOF
```

## Task 4: Retarget OVH to `ovh-base` and plain NixOS install only

**Files:**
- Create: `core/os/hosts/ovh-base.nix`
- Delete: `core/os/hosts/ovh-vps.nix`
- Modify: `core/scripts/nixpi-deploy-ovh.sh`
- Modify: `core/scripts/nixpi-ovh-common.sh`
- Modify: `flake.nix`
- Modify: `tests/integration/nixpi-deploy-ovh.test.ts`
- Modify: `tests/integration/ovh-vps-config.test.ts`
- Test: `tests/integration/nixpi-deploy-ovh.test.ts`
- Test: `tests/integration/ovh-vps-config.test.ts`

- [ ] **Step 1: Add the plain OVH base profile**

```nix
# core/os/hosts/ovh-base.nix
{ lib, pkgs, modulesPath, ... }:

{
  imports = [ (modulesPath + "/profiles/qemu-guest.nix") ];

  networking.hostName = lib.mkDefault "ovh-base";
  system.stateVersion = "25.05";

  nix.settings.experimental-features = [ "nix-command" "flakes" ];

  services.openssh = {
    enable = true;
    settings = {
      PasswordAuthentication = false;
      PermitRootLogin = "prohibit-password";
    };
  };

  environment.systemPackages = with pkgs; [
    git
    curl
  ];

  boot.loader = {
    systemd-boot.enable = lib.mkForce false;
    efi.canTouchEfiVariables = lib.mkForce false;
    grub = {
      enable = true;
      efiSupport = true;
      efiInstallAsRemovable = true;
      device = "nodev";
    };
  };

  services.qemuGuest.enable = lib.mkDefault true;
}
```

- [ ] **Step 2: Replace `ovh-vps` wiring in `flake.nix`**

```nix
ovh-base = mkConfiguredStableSystem {
  inherit system;
  modules = [
    disko.nixosModules.disko
    ./core/os/disko/ovh-single-disk.nix
    ./core/os/hosts/ovh-base.nix
  ];
};
```

- [ ] **Step 3: Narrow the deploy wrapper to base-install arguments only**

```bash
# core/scripts/nixpi-deploy-ovh.sh key changes
Usage: nixpi-deploy-ovh --target-host root@IP --disk /dev/sdX [--flake .#ovh-base] [--hostname HOSTNAME] [extra nixos-anywhere args...]

Destructive plain NixOS base install for an OVH VPS in rescue mode.
```

```bash
local flake_ref="${NIXPI_REPO_ROOT:-.}#ovh-base"
```

```bash
# remove these options entirely
--bootstrap-user
--bootstrap-password-hash
--netbird-setup-key-file
```

- [ ] **Step 4: Remove final-host override logic from `nixpi-ovh-common.sh`**

```bash
build_deploy_flake() {
	local repo_url="$1"
	local base_attr="$2"
	local hostname="$3"
	local disk="$4"

	cat <<EOF_FLAKE
{
  inputs.nixpi.url = "${repo_url}";

  outputs = { nixpi, ... }: {
    nixosConfigurations.deploy = nixpi.nixosConfigurations.${base_attr}.extendModules {
      modules = [
        ({ lib, ... }: {
          networking.hostName = lib.mkForce "${hostname}";
          disko.devices.disk.main.device = lib.mkForce "${disk}";
        })
      ];
    };
  };
}
EOF_FLAKE
}
```

```bash
log "nixos-anywhere will install a plain OVH base system"
log "Bootstrap NixPI after first boot with nixpi-bootstrap-host"
```

- [ ] **Step 5: Update the deploy wrapper tests to the new contract**

```ts
expect(generatedFlake).toContain("nixosConfigurations.deploy = nixpi.nixosConfigurations.ovh-base.extendModules");
expect(generatedFlake).not.toContain("nixpi.primaryUser =");
expect(generatedFlake).not.toContain("nixpi.netbird");
```

```ts
const result = await run(
	"nix",
	["eval", ".#nixosConfigurations.ovh-base.config.services.openssh.enable", "--json"],
	undefined,
	repoRoot,
);

expect(JSON.parse(result.stdout)).toBe(true);
```

- [ ] **Step 6: Run the focused OVH checks**

Run: `npm test -- --runInBand tests/integration/nixpi-deploy-ovh.test.ts tests/integration/ovh-vps-config.test.ts`
Expected: PASS

Run: `nix eval .#nixosConfigurations.ovh-base.config.networking.hostName --json`
Expected: `"ovh-base"`

Run: `nix build .#packages.x86_64-linux.nixpi-deploy-ovh --no-link`
Expected: PASS

- [ ] **Step 7: Commit the OVH retarget**

```bash
git add core/os/hosts/ovh-base.nix core/scripts/nixpi-deploy-ovh.sh core/scripts/nixpi-ovh-common.sh flake.nix tests/integration/nixpi-deploy-ovh.test.ts tests/integration/ovh-vps-config.test.ts
git rm core/os/hosts/ovh-vps.nix
git commit -F- <<'EOF'
Retarget OVH provisioning to a plain base system

OVH now installs only a plain NixOS base profile. NixPI itself is
bootstrapped afterward through the shared host-owned flow instead of
being embedded into the install-time machine profile.

Constraint: OVH is day-0 provisioning only, not a special steady-state product lane
Rejected: Keep bootstrap credentials in the deploy wrapper | couples day-0 provisioning to final NixPI state again
Confidence: high
Scope-risk: moderate
Directive: Keep provider install profiles free of NixPI-layer ownership
Tested: `npm test -- --runInBand tests/integration/nixpi-deploy-ovh.test.ts tests/integration/ovh-vps-config.test.ts`; `nix eval .#nixosConfigurations.ovh-base.config.networking.hostName --json`; `nix build .#packages.x86_64-linux.nixpi-deploy-ovh --no-link`
Not-tested: Live OVH rescue-mode install
EOF
```

## Task 5: Rewrite docs, skills, and final verification around the new model

**Files:**
- Modify: `README.md`
- Modify: `docs/install.md`
- Modify: `docs/operations/quick-deploy.md`
- Modify: `docs/operations/ovh-rescue-deploy.md`
- Modify: `docs/operations/first-boot-setup.md`
- Modify: `docs/operations/live-testing.md`
- Modify: `docs/architecture/runtime-flows.md`
- Modify: `docs/reference/infrastructure.md`
- Modify: `core/pi/persona/SKILL.md`
- Test: `tests/integration/standards-guard.test.ts`
- Test: full verification commands

- [ ] **Step 1: Rewrite the README quick start and rebuild guidance**

````md
It combines:
- a plain machine/provider-specific NixOS base install
- a host-owned `/etc/nixos` system root
- a shared `nixpi-bootstrap-host` integration path for already-installed NixOS systems
- a plain shell runtime for SSH and local tty sessions
````

````md
Install onto a fresh OVH VPS from rescue mode:

```bash
nix run .#nixpi-deploy-ovh -- \
  --target-host root@SERVER_IP \
  --disk /dev/sdX
```

After the machine boots, SSH in and bootstrap NixPI:

```bash
nix run github:alexradunet/nixpi#nixpi-bootstrap-host -- \
  --primary-user alex \
  --hostname bloom-eu-1 \
  --timezone Europe/Bucharest \
  --keyboard us
```
````

- [ ] **Step 2: Rewrite install and quick-deploy docs around base-install-then-bootstrap**

```md
NixPI supports one host-owned install story:

1. install a plain NixOS base for the machine
2. run `nixpi-bootstrap-host` on the machine
3. rebuild through `/etc/nixos#nixos`
```

```md
`nixos-anywhere` is used only for plain base-system provisioning. It does not install the final NixPI host directly.
```

- [ ] **Step 3: Rewrite first-boot and runtime docs to remove `/srv/nixpi` / `nixpi-rebuild-pull`**

````md
### 2. Bootstrap NixPI on the machine

```bash
nix run github:alexradunet/nixpi#nixpi-bootstrap-host -- \
  --primary-user alex \
  --hostname bloom-eu-1 \
  --timezone Europe/Bucharest \
  --keyboard us
```
````

````md
- `/etc/nixos` is the only steady-state source of truth
- NixPI is layered into the host through generated helper files
- repo checkouts are not part of the supported convergence path
````

- [ ] **Step 4: Update infrastructure and persona guidance to the clean-break contract**

```md
| Running host source of truth | `/etc/nixos` |
| Standard bootstrap command | `nix run github:alexradunet/nixpi#nixpi-bootstrap-host -- ...` |
| Standard rebuild command | `sudo nixpi-rebuild` |
```

```md
- Canonical bootstrap path: `nix run github:alexradunet/nixpi#nixpi-bootstrap-host -- ...`.
- Canonical rebuild path: `sudo nixpi-rebuild`.
```

- [ ] **Step 5: Run the standards guard and then the full repo verification**

Run: `npm test -- --runInBand tests/integration/standards-guard.test.ts`
Expected: PASS

Run: `npm run check`
Expected: PASS

Run: `npm test`
Expected: PASS

Run: `nix build .#checks.x86_64-linux.nixpi-bootstrap-host --no-link -L`
Expected: PASS

- [ ] **Step 6: Commit the doc and standards rewrite**

```bash
git add README.md docs/install.md docs/operations/quick-deploy.md docs/operations/ovh-rescue-deploy.md docs/operations/first-boot-setup.md docs/operations/live-testing.md docs/architecture/runtime-flows.md docs/reference/infrastructure.md core/pi/persona/SKILL.md tests/integration/standards-guard.test.ts
git commit -F- <<'EOF'
Document NixPI as a host-owned bootstrap layer

The user-facing docs now describe one clean-break install story:
install a plain NixOS base, bootstrap NixPI onto `/etc/nixos`, and
rebuild only from the installed host flake.

Constraint: Production guidance must not teach the removed repo-profile lanes
Rejected: Leave mixed docs during migration | guarantees operator confusion and stale tests
Confidence: high
Scope-risk: moderate
Directive: Keep `/etc/nixos` as the only supported steady-state root in all production docs
Tested: `npm test -- --runInBand tests/integration/standards-guard.test.ts`; `npm run check`; `npm test`; `nix build .#checks.x86_64-linux.nixpi-bootstrap-host --no-link -L`
Not-tested: Manual doc walkthrough on a live OVH machine
EOF
```

## Self-Review

- **Spec coverage:** The tasks cover the shared bootstrap path, OVH base install, removal of legacy rebuild/reinstall lanes, conservative handling of existing flake hosts, and the required doc/test rewrites.
- **Placeholder scan:** No `TODO` / `TBD` placeholders remain; every task has concrete files, code, commands, and expected outcomes.
- **Type consistency:** The plan uses one consistent naming set: `nixpi-bootstrap-host`, `ovh-base`, `/etc/nixos#nixos`, `nixpi-integration.nix`, and `nixpi-host.nix`.
