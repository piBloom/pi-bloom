# Canonical Rebuild Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a canonical `nixpi-rebuild-pull [branch-or-ref]` operator command, keep `nixpi-rebuild` global and rebuild-only, and teach Pi plus the docs that `/srv/nixpi` is the source-of-truth checkout for the running OS.

**Architecture:** Keep `/srv/nixpi` as the only managed checkout and `/etc/nixos#nixos` as the only rebuild target. Implement the new pull-and-rebuild path as a narrow shell wrapper plus package wiring, protect it with focused standards/integration tests, and update Pi-facing prompts/skills/docs so the canonical repo model is explained consistently everywhere.

**Tech Stack:** Bash wrappers, Nix package derivations, NixOS module wiring, Vitest, Nix flake assertions, Markdown docs

---

## File Structure

- Modify: `tests/integration/standards-guard.test.ts` — add text guards for the new wrapper and canonical repo messaging
- Create: `core/scripts/nixpi-rebuild-pull.sh` — canonical pull-and-rebuild wrapper for `/srv/nixpi`
- Create: `core/os/pkgs/nixpi-rebuild-pull/default.nix` — package derivation that installs the wrapper globally
- Modify: `core/os/modules/tooling.nix` — add the new package to `environment.systemPackages`
- Modify: `flake.nix` — expose the package and add check assertions for the wrapper contract
- Modify: `core/pi/persona/SKILL.md` — make Pi aware that `/srv/nixpi` is the canonical OS source checkout
- Modify: `core/pi/skills/self-evolution/SKILL.md` — reinforce the canonical repo model in Pi’s code-change guidance
- Modify: `core/pi/skills/recovery/SKILL.md` — document `/srv/nixpi` + `nixpi-rebuild-pull` in recovery/update guidance
- Modify: `core/pi/extensions/os/actions.ts` — strengthen operator-facing canonical checkout messaging in OS update responses
- Modify: `core/os/pkgs/bootstrap/nixpi-bootstrap-vps.sh` — update bootstrap completion hint to mention the canonical repo and the new pull-and-rebuild command
- Modify: `README.md` — document the canonical repo + rebuild workflow
- Modify: `docs/operations/quick-deploy.md` — document the new steady-state update command
- Modify: `docs/operations/first-boot-setup.md` — explain the canonical `/srv/nixpi` rebuild/update model

### Task 1: Lock the new wrapper and canonical repo messaging with failing tests

**Files:**
- Modify: `tests/integration/standards-guard.test.ts`
- Modify: `flake.nix`
- Test: `tests/integration/standards-guard.test.ts`

- [ ] **Step 1: Write the failing standards guard**

Append this test to `tests/integration/standards-guard.test.ts`:

```ts
	const rebuildPullScriptPath = path.join(repoRoot, "core/scripts/nixpi-rebuild-pull.sh");
	const selfEvolutionSkillPath = path.join(repoRoot, "core/pi/skills/self-evolution/SKILL.md");

	it("documents the canonical /srv/nixpi rebuild workflow and pull wrapper", () => {
		const readme = readFileSync(path.join(repoRoot, "README.md"), "utf8");
		const bootstrapScript = readFileSync(
			path.join(repoRoot, "core/os/pkgs/bootstrap/nixpi-bootstrap-vps.sh"),
			"utf8",
		);
		const osActions = readFileSync(path.join(repoRoot, "core/pi/extensions/os/actions.ts"), "utf8");
		const selfEvolutionSkill = readFileSync(selfEvolutionSkillPath, "utf8");
		const rebuildPullScript = readFileSync(rebuildPullScriptPath, "utf8");

		expect(rebuildPullScript).toContain('REPO_DIR="/srv/nixpi"');
		expect(rebuildPullScript).toContain('TARGET_REF="${1:-main}"');
		expect(rebuildPullScript).toContain('git -C "$REPO_DIR" fetch origin');
		expect(rebuildPullScript).toContain('git -C "$REPO_DIR" reset --hard "origin/$TARGET_REF"');
		expect(rebuildPullScript).toContain('exec nixos-rebuild switch --flake /etc/nixos#nixos --impure');

		expect(readme).toContain("/srv/nixpi");
		expect(readme).toContain("sudo nixpi-rebuild-pull");
		expect(bootstrapScript).toContain("/srv/nixpi");
		expect(bootstrapScript).toContain("nixpi-rebuild-pull");
		expect(osActions).toContain("/srv/nixpi");
		expect(selfEvolutionSkill).toContain("/srv/nixpi");
		expect(selfEvolutionSkill).toContain("nixpi-rebuild-pull");
	});
```

- [ ] **Step 2: Add the flake assertion target to the plan before implementation**

Add this assertion block near the existing `nixpi-rebuild` assertions in `flake.nix`:

```nix
            test -x "${./core/scripts/nixpi-rebuild-pull.sh}"
            grep -F 'REPO_DIR="/srv/nixpi"' "${./core/scripts/nixpi-rebuild-pull.sh}" >/dev/null
            grep -F 'TARGET_REF="${1:-main}"' "${./core/scripts/nixpi-rebuild-pull.sh}" >/dev/null
            grep -F 'reset --hard "origin/$TARGET_REF"' "${./core/scripts/nixpi-rebuild-pull.sh}" >/dev/null
            grep -F 'nixos-rebuild switch --flake /etc/nixos#nixos' "${./core/scripts/nixpi-rebuild-pull.sh}" >/dev/null
```

- [ ] **Step 3: Run the test to verify it fails**

Run:

```bash
npx vitest run tests/integration/standards-guard.test.ts
```

Expected: FAIL because `core/scripts/nixpi-rebuild-pull.sh` does not exist yet and the canonical repo messaging has not been updated everywhere.

- [ ] **Step 4: Commit the failing guard**

Run:

```bash
git add tests/integration/standards-guard.test.ts flake.nix
git commit -F - <<'EOF'
Prove the canonical rebuild workflow starts from a failing guard

This adds a red-state standards guard for the new pull-and-rebuild wrapper
and the canonical /srv/nixpi operator messaging before the implementation
changes any behavior.

Constraint: The new workflow must stay test-first
Constraint: Canonical repo messaging must stay aligned with the wrapper contract
Rejected: Rely on manual review of docs and scripts | too easy to let the command surface drift
Confidence: high
Scope-risk: narrow
Reversibility: clean
Directive: Keep the guard focused on the canonical checkout model, not general Git workflow flexibility
Tested: npx vitest run tests/integration/standards-guard.test.ts (expected fail)
Not-tested: Wrapper runtime behavior
EOF
```

### Task 2: Add and wire the canonical `nixpi-rebuild-pull` command

**Files:**
- Create: `core/scripts/nixpi-rebuild-pull.sh`
- Create: `core/os/pkgs/nixpi-rebuild-pull/default.nix`
- Modify: `core/os/modules/tooling.nix`
- Modify: `flake.nix`
- Test: `tests/integration/standards-guard.test.ts`

- [ ] **Step 1: Write the minimal wrapper**

Create `core/scripts/nixpi-rebuild-pull.sh` with this content:

```bash
#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/srv/nixpi"
TARGET_REF="${1:-main}"

git config --global --add safe.directory "$REPO_DIR" >/dev/null 2>&1 || true
git -C "$REPO_DIR" fetch origin
git -C "$REPO_DIR" reset --hard "origin/$TARGET_REF"

exec nixos-rebuild switch --flake /etc/nixos#nixos --impure
```

- [ ] **Step 2: Package the wrapper**

Create `core/os/pkgs/nixpi-rebuild-pull/default.nix`:

```nix
{ stdenvNoCC }:

stdenvNoCC.mkDerivation {
  pname = "nixpi-rebuild-pull";
  version = "0.1.0";

  dontUnpack = true;

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/bin"
    install -m 0755 ${../../../scripts/nixpi-rebuild-pull.sh} "$out/bin/nixpi-rebuild-pull"
    runHook postInstall
  '';
}
```

- [ ] **Step 3: Wire it into the global tooling bundle**

Update `core/os/modules/tooling.nix` to:

```nix
let
  nixpiRebuild = pkgs.callPackage ../pkgs/nixpi-rebuild { };
  nixpiRebuildPull = pkgs.callPackage ../pkgs/nixpi-rebuild-pull { };
  setupApplyPackage = pkgs.callPackage ../pkgs/nixpi-setup-apply { };
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
    nixpiRebuildPull
    setupApplyPackage
  ] ++ lib.optionals config.nixpi.security.fail2ban.enable [ pkgs.fail2ban ];
}
```

- [ ] **Step 4: Expose the package in `flake.nix`**

Update `mkPackages` in `flake.nix` to include:

```nix
          nixpi-rebuild = pkgs.callPackage ./core/os/pkgs/nixpi-rebuild { };
          nixpi-rebuild-pull = pkgs.callPackage ./core/os/pkgs/nixpi-rebuild-pull { };
          nixpi-setup-apply = pkgs.callPackage ./core/os/pkgs/nixpi-setup-apply { };
```

- [ ] **Step 5: Run the targeted standards guard**

Run:

```bash
npx vitest run tests/integration/standards-guard.test.ts
```

Expected: still FAIL because the Pi-facing text and docs have not been updated yet, but the wrapper-content assertions should now pass.

- [ ] **Step 6: Commit the wrapper wiring**

Run:

```bash
git add core/scripts/nixpi-rebuild-pull.sh core/os/pkgs/nixpi-rebuild-pull/default.nix core/os/modules/tooling.nix flake.nix
git commit -F - <<'EOF'
Add a canonical pull-and-rebuild wrapper for /srv/nixpi

This introduces nixpi-rebuild-pull as the narrow operator command for
updating the canonical /srv/nixpi checkout and then rebuilding the system
through /etc/nixos#nixos.

Constraint: /srv/nixpi must remain the only managed checkout
Constraint: Rebuilds must still flow through /etc/nixos#nixos
Rejected: Make the wrapper operate on the caller's current repo | weakens the canonical source-of-truth model
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Keep branch handling to one optional positional ref and keep Git update logic scoped to /srv/nixpi only
Tested: npx vitest run tests/integration/standards-guard.test.ts (expected partial failure on remaining messaging work)
Not-tested: End-to-end wrapper execution on a live host
EOF
```

### Task 3: Teach Pi and operator-facing messages about the canonical `/srv/nixpi` workflow

**Files:**
- Modify: `core/pi/persona/SKILL.md`
- Modify: `core/pi/skills/self-evolution/SKILL.md`
- Modify: `core/pi/skills/recovery/SKILL.md`
- Modify: `core/pi/extensions/os/actions.ts`
- Modify: `core/os/pkgs/bootstrap/nixpi-bootstrap-vps.sh`
- Test: `tests/integration/standards-guard.test.ts`

- [ ] **Step 1: Update Pi’s canonical-checkout awareness**

Replace the “System Operations” section in `core/pi/persona/SKILL.md` with:

```md
### System Operations

- OS management: NixOS generation status, updates, rollback.
- Service control: systemd unit management.
- Canonical system source checkout: `/srv/nixpi`.
- Canonical rebuild path: `sudo nixpi-rebuild`.
- Canonical update-and-rebuild path: `sudo nixpi-rebuild-pull [branch-or-ref]`.
```

Update the “Code Evolution Workflow” section in `core/pi/skills/self-evolution/SKILL.md` to include:

```md
**Local repo path**: `/srv/nixpi`
**Canonical update command**: `sudo nixpi-rebuild-pull [branch-or-ref]`
**Canonical rebuild command**: `sudo nixpi-rebuild`
```

Update the “OS Update Failure” section in `core/pi/skills/recovery/SKILL.md` to:

```md
4. Common causes:
   - Network interruption during build: retry `sudo nixpi-rebuild-pull`
   - Evaluation error: check `/etc/nixos/flake.nix` and the canonical checkout at `/srv/nixpi`
   - Disk full: check with `system_health`, run `nix-collect-garbage`
5. Canonical steady-state workflow:
   - update `/srv/nixpi` with `sudo nixpi-rebuild-pull [branch-or-ref]`
   - rebuild only with `sudo nixpi-rebuild` when the checkout is already current
```

- [ ] **Step 2: Update OS action messaging and bootstrap hint**

Adjust the error text in `core/pi/extensions/os/actions.ts` to:

```ts
	return errorResult(
		`System flake not found at ${flake}. NixPI rebuilds through the standard /etc/nixos flake, which should import the canonical checkout at /srv/nixpi. ` +
			`Run bootstrap again or initialize /etc/nixos/flake.nix so it imports /srv/nixpi before applying updates.`,
	);
```

And replace the canonical branch guidance text with:

```ts
				`${message}. switch /srv/nixpi to main or use the canonical pull wrapper before rebuilding from ${getSystemFlakeDir()}.`,
```

Update the bootstrap completion line in `core/os/pkgs/bootstrap/nixpi-bootstrap-vps.sh` to:

```bash
log "Bootstrap complete. /srv/nixpi is the canonical source checkout. Use 'nixpi-rebuild' to rebuild the current checkout or 'nixpi-rebuild-pull' to update and rebuild."
```

- [ ] **Step 3: Run the targeted standards guard**

Run:

```bash
npx vitest run tests/integration/standards-guard.test.ts
```

Expected: still FAIL because the operator docs have not been updated yet, but Pi-facing script/message assertions should now pass.

- [ ] **Step 4: Commit the Pi/message updates**

Run:

```bash
git add core/pi/persona/SKILL.md core/pi/skills/self-evolution/SKILL.md core/pi/skills/recovery/SKILL.md core/pi/extensions/os/actions.ts core/os/pkgs/bootstrap/nixpi-bootstrap-vps.sh
git commit -F - <<'EOF'
Teach Pi that /srv/nixpi is the canonical OS checkout

This updates Pi-facing prompts, recovery guidance, OS action messaging, and
bootstrap output so the assistant consistently explains that /srv/nixpi is
the source-of-truth checkout for updates and rebuilds.

Constraint: Pi guidance must match the real operator workflow
Constraint: Canonical repo messaging must stay aligned with /etc/nixos#nixos rebuilds
Rejected: Keep the source-of-truth model implicit in docs only | leaves Pi unable to guide operators consistently
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Keep /srv/nixpi messaging explicit anywhere Pi talks about updates or rebuilds
Tested: npx vitest run tests/integration/standards-guard.test.ts (expected partial failure on remaining docs work)
Not-tested: Live Pi chat responses
EOF
```

### Task 4: Update the docs and close the standards guard

**Files:**
- Modify: `README.md`
- Modify: `docs/operations/quick-deploy.md`
- Modify: `docs/operations/first-boot-setup.md`
- Test: `tests/integration/standards-guard.test.ts`

- [ ] **Step 1: Update the top-level README**

Change the steady-state section in `README.md` to:

````md
Then operate from the canonical checkout:

```bash
cd /srv/nixpi
git status
sudo nixpi-rebuild
```

To update the canonical checkout and rebuild in one step:

```bash
sudo nixpi-rebuild-pull
```
````

- [ ] **Step 2: Update operator workflow docs**

In `docs/operations/quick-deploy.md`, replace the steady-state update example block with:

````md
Treat `/srv/nixpi` as the installed source of truth. Use it for edits, sync, and rebuilds.

```bash
cd /srv/nixpi
sudo nixpi-rebuild
```

To update the canonical checkout and rebuild in one command:

```bash
sudo nixpi-rebuild-pull
sudo nixpi-rebuild-pull main
```
````

In `docs/operations/first-boot-setup.md`, replace the canonical repo flow section with:

````md
### 4. Verify the Canonical Repo Flow

```bash
cd /srv/nixpi
git status
sudo nixpi-rebuild
```

Expected result: the machine rebuilds from `/etc/nixos` while importing NixPI from `/srv/nixpi`.

To update the canonical checkout and rebuild in one step:

```bash
sudo nixpi-rebuild-pull
```
````

- [ ] **Step 3: Run full verification**

Run:

```bash
npx vitest run tests/integration/standards-guard.test.ts
npm run check
npx tsc --noEmit
npm test
```

Expected:

- the targeted standards guard passes
- Biome passes
- TypeScript passes
- full test suite passes

- [ ] **Step 4: Commit the completed workflow**

Run:

```bash
git add README.md docs/operations/quick-deploy.md docs/operations/first-boot-setup.md
git commit -F - <<'EOF'
Document the canonical pull-and-rebuild operator workflow

This updates the public docs so /srv/nixpi is presented as the source of
truth for the running OS, with nixpi-rebuild as the rebuild-only command
and nixpi-rebuild-pull as the standard update-and-rebuild workflow.

Constraint: Operator docs must reinforce one canonical checkout model
Constraint: The documented rebuild target must remain /etc/nixos#nixos
Rejected: Explain the workflow only in bootstrap output | too easy for steady-state operators to miss
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Keep docs, Pi messaging, and wrapper behavior synchronized around /srv/nixpi
Tested: npx vitest run tests/integration/standards-guard.test.ts
Tested: npm run check
Tested: npx tsc --noEmit
Tested: npm test
Not-tested: Live host execution of nixpi-rebuild-pull on an installed system
EOF
```
