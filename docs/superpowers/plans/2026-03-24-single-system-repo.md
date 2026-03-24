# Single System Repo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Converge NixPI on a single canonical Git worktree at `/srv/nixpi`, keep `/etc/nixos` as a tiny host-only flake entrypoint, and remove supported reliance on home and proposal/apply repo copies.

**Architecture:** The implementation should change the invariant in layers. First, centralize the runtime path policy and rebuild-branch checks. Next, make bootstrap and first-boot create and validate `/srv/nixpi` while generating a minimal `/etc/nixos` host flake. Then update operator tooling, tests, and docs so all supported workflows point at `/srv/nixpi` and rebuild through `/etc/nixos`.

**Tech Stack:** TypeScript/Node, NixOS modules, bash setup scripts, Python installer tests, NixOS VM tests, Git.

---

## File Structure

### Existing files to modify

- `core/lib/filesystem.ts`
  Own the canonical repo path and system flake path APIs. This is the primary place to replace the `/home/$USER/nixpi` assumption with `/srv/nixpi` and keep `/etc/nixos` as the stable flake directory.
- `core/lib/repo-metadata.ts`
  Validate and persist canonical repo metadata. This must stop encoding a home-directory path and instead validate `/srv/nixpi`.
- `tests/lib/filesystem.test.ts`
  Unit coverage for the path and metadata APIs. This should lock the new `/srv/nixpi` and `/etc/nixos` invariants before implementation.
- `core/os/modules/firstboot.nix`
  Generates the installed host layer and currently bootstraps the canonical repo checkout. This is where `/etc/nixos/flake.nix` must become a tiny host-only entrypoint that imports `/srv/nixpi`, and where rebuilds should fail when the repo is not on `main`.
- `core/scripts/setup-wizard.sh`
  Controls the first-boot operator flow and prints rebuild guidance. It currently assumes the home checkout story in places and should switch to `/srv/nixpi`.
- `core/os/pkgs/installer/nixpi-installer.sh`
  Installer shell logic that seeds the initial system and user-facing messages. It should describe the `/srv/nixpi` checkout model and stop implying `~/nixpi`.
- `core/os/pkgs/installer/test_nixpi_installer.py`
  Python-level bootstrap tests for clone validation and installer behavior. Extend these around `/srv/nixpi` creation and hard-fail validation.
- `core/os/modules/update.nix`
  Defines the update service’s flake path and conditions. This should stay pointed at `/etc/nixos` while the generic code path moves to `/srv/nixpi`.
- `core/pi/extensions/os/actions.ts`
  OS operation entrypoints that surface rebuild/update behavior to agents. They should align error messages and guidance with the new canonical repo model.
- `core/pi/extensions/os/actions-proposal.ts`
  Proposal/apply path usage still depends on `getNixPiRepoDir()` and `getSystemFlakeDir()`. This needs review so proposal flows do not silently reintroduce unsupported repo defaults.
- `core/scripts/system-update.sh`
  Root-managed update entrypoint. It currently defaults to the home checkout and must enforce the new `/etc/nixos` flake path plus the `main`-only rebuild rule.
- `core/os/modules/broker.nix`
  Broker-driven privileged rebuild entrypoint. It must stop defaulting to `/home/$USER/nixpi` and enforce the same rebuild branch contract as other supported update paths.
- `core/pi/extensions/nixpi/actions.ts`
  Repo-aware NixPI actions may expose status or operational guidance that should reflect `/srv/nixpi`.
- `core/os/services/nixpi-update.nix`
  If update services or scripts surface the canonical repo or expected flake path, align them with the new branch and rebuild constraints.
- `docs/install.md`
  Install narrative still says `~/nixpi` plus `/etc/nixos`. Rewrite around `/srv/nixpi` and host-only `/etc/nixos`.
- `docs/operations/quick-deploy.md`
  Operational quick-deploy docs still describe the home checkout as canonical.
- `docs/operations/first-boot-setup.md`
  First-boot docs must explain `/srv/nixpi`, `/etc/nixos`, and rebuilding from `main`.
- `docs/operations/index.md`
  Central operations entrypoint should point to the updated rebuild model.
- `docs/architecture/runtime-flows.md`
  Architecture docs currently reference the older clone layout and should be brought back in sync once the behavior is real.
- `AGENTS.md`
  Repo instructions currently enforce `/home/alex/nixpi` for this workstation. This needs an explicit follow-up decision after product changes land, because it currently conflicts with the new product architecture.

### Existing tests to modify

- `tests/nixos/nixpi-firstboot.nix`
  Primary end-to-end coverage for the installed checkout and generated host flake. It should validate `/srv/nixpi`, reject legacy clones, and check `/etc/nixos/flake.nix`.
- `tests/nixos/nixpi-update.nix`
  Update path smoke coverage for `/etc/nixos/flake.nix` and update service conditions.
- `tests/nixos/nixpi-installer-smoke.nix`
  Installer smoke test for generated `/etc/nixos` content and bootstrap artifacts.
- `tests/nixos/nixpi-daemon.nix`
  Service working-directory and environment assumptions currently mention `/home/pi/nixpi` and must be updated if the daemon should operate from `/srv/nixpi`.
- `tests/extensions/os-proposal.test.ts`
  Proposal/apply extension tests currently assume `getNixPiRepoDir()` gives an isolated writable repo path.
- `tests/extensions/os-update.test.ts`
  Extension tests for update commands and surfaced operator guidance should be updated to the new branch and flake model.
- `tests/extensions/os.test.ts`
  General OS extension tests may hardcode the legacy home checkout paths and should be updated as part of the runtime path-policy change.

### New document to create

- `docs/operations/migrating-to-srv-nixpi.md`
  Explicit migration guide for machines currently using `/home/$USER/nixpi` or proposal/apply clones. The spec calls for an explicit migration path instead of silent compatibility logic.

---

### Task 1: Preserve Proposal Isolation Before Changing the Global Repo Path

**Files:**
- Modify: `core/pi/extensions/os/actions-proposal.ts`
- Modify: `tests/extensions/os-proposal.test.ts`

- [ ] **Step 1: Write the failing proposal-path test first**

Update `tests/extensions/os-proposal.test.ts` so proposal behavior is explicit and independent from the canonical repo path. The test should prove proposal code uses a dedicated proposal path and does not write into `/srv/nixpi`:

```ts
expect(details.repoDir).toBe("/var/lib/nixpi/pi-nixpi");
expect(text).toContain("Local proposal repo: /var/lib/nixpi/pi-nixpi");
```

If the product direction is to retire proposal clones entirely, change the test instead to assert a clear unsupported error. Do not proceed until this behavior is explicit in tests.

- [ ] **Step 2: Run the proposal extension test and confirm failure**

Run: `nix shell nixpkgs#nodejs -c npm test -- tests/extensions/os-proposal.test.ts`

Expected: FAIL because proposal behavior is still coupled to `getNixPiRepoDir()`.

- [ ] **Step 3: Decouple proposal flows from the canonical repo helper**

Implement one of these minimal shapes:

```ts
const PROPOSAL_REPO_DIR = "/var/lib/nixpi/pi-nixpi";
```

or an explicit “proposal clones are unsupported” error path. The important invariant is that changing the canonical repo to `/srv/nixpi` must not silently redirect proposal operations into the canonical worktree.

- [ ] **Step 4: Run the proposal extension test again**

Run: `nix shell nixpkgs#nodejs -c npm test -- tests/extensions/os-proposal.test.ts`

Expected: PASS

- [ ] **Step 5: Commit the proposal-flow isolation change**

```bash
git add core/pi/extensions/os/actions-proposal.ts tests/extensions/os-proposal.test.ts
git commit -m "refactor: decouple proposal repo from canonical repo path"
```

### Task 2: Lock the Canonical Path and Branch Policy in Unit Tests

**Files:**
- Modify: `tests/lib/filesystem.test.ts`
- Modify: `core/lib/filesystem.ts`
- Modify: `core/lib/repo-metadata.ts`
- Modify: `tests/extensions/os-update.test.ts`
- Modify: `tests/extensions/os.test.ts`

- [ ] **Step 1: Write failing tests for the new canonical repo and system flake paths**

Update `tests/lib/filesystem.test.ts` so it asserts:

```ts
expect(getNixPiRepoDir()).toBe("/srv/nixpi");
expect(getSystemFlakeDir()).toBe("/etc/nixos");
expect(getCanonicalRepoMetadataPath()).toBe("/etc/nixpi/canonical-repo.json");
```

Also change metadata validation expectations away from `/home/<user>/nixpi`:

```ts
await expect(
  writeCanonicalRepoMetadata({ path: "/home/alex/nixpi", origin: "https://example.invalid/repo.git", branch: "main" }),
).rejects.toThrow("Invalid canonical repo metadata path: expected /srv/nixpi, got /home/alex/nixpi");
```

- [ ] **Step 2: Add a failing branch-policy test for rebuild validation helpers**

If no helper exists yet, introduce a test-first expectation for one:

```ts
expect(() => assertSupportedRebuildBranch("feature/test")).toThrow(
  "Supported rebuilds require /srv/nixpi to be on main",
);
expect(() => assertSupportedRebuildBranch("main")).not.toThrow();
```

- [ ] **Step 3: Extend extension tests that surface the old path model**

Update any old-path assertions in `tests/extensions/os-update.test.ts` and `tests/extensions/os.test.ts` so they expect:

```ts
"/srv/nixpi"
"/etc/nixos"
"switch to main"
```

- [ ] **Step 4: Run the targeted unit and extension test suites and confirm failure**

Run:

```bash
nix shell nixpkgs#nodejs -c npm test -- tests/lib/filesystem.test.ts
nix shell nixpkgs#nodejs -c npm test -- tests/extensions/os-update.test.ts
nix shell nixpkgs#nodejs -c npm test -- tests/extensions/os.test.ts
```

Expected: FAIL because the current code still returns `/home/<user>/nixpi`, home-based metadata paths, and has no rebuild-branch helper.

- [ ] **Step 5: Implement the minimal path-policy changes**

Make these concrete code changes:

```ts
export const CANONICAL_REPO_DIR = "/srv/nixpi";
export const SYSTEM_FLAKE_DIR = "/etc/nixos";
export const CANONICAL_REPO_METADATA_PATH = "/etc/nixpi/canonical-repo.json";

export function getNixPiRepoDir(): string {
  return CANONICAL_REPO_DIR;
}

export function getSystemFlakeDir(): string {
  return SYSTEM_FLAKE_DIR;
}

export function assertSupportedRebuildBranch(branch: string): void {
  if (branch !== "main") {
    throw new Error("Supported rebuilds require /srv/nixpi to be on main");
  }
}
```

Update metadata validation to require `path === "/srv/nixpi"` and store metadata under `/etc/nixpi/canonical-repo.json`.

- [ ] **Step 6: Run the targeted unit and extension test suites again**

Run:

```bash
nix shell nixpkgs#nodejs -c npm test -- tests/lib/filesystem.test.ts
nix shell nixpkgs#nodejs -c npm test -- tests/extensions/os-update.test.ts
nix shell nixpkgs#nodejs -c npm test -- tests/extensions/os.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit the path-policy change**

```bash
git add core/lib/filesystem.ts core/lib/repo-metadata.ts tests/lib/filesystem.test.ts tests/extensions/os-update.test.ts tests/extensions/os.test.ts
git commit -m "refactor: centralize /srv/nixpi canonical repo policy"
```

### Task 3: Create `/srv/nixpi` With the Right Ownership and Generate a Tiny Host Flake

**Files:**
- Modify: `core/os/modules/firstboot.nix`
- Modify: `core/scripts/setup-wizard.sh`
- Modify: `tests/nixos/nixpi-firstboot.nix`

- [ ] **Step 1: Write failing NixOS test assertions for the new installed layout**

Extend `tests/nixos/nixpi-firstboot.nix` with assertions like:

```python
nixpi.succeed("test -d /srv/nixpi/.git")
nixpi.fail("test -e /home/pi/nixpi")
nixpi.fail("test -e /var/lib/nixpi/pi-nixpi")
nixpi.succeed("grep -q '/srv/nixpi' /etc/nixos/flake.nix")
nixpi.fail("test -f /etc/nixos/flake.lock")
nixpi.succeed("test -f /etc/nixpi/canonical-repo.json")
```

Also add a branch guard assertion:

```python
nixpi.succeed(\"su - pi -c 'cd /srv/nixpi && git switch -c feature/test'\")
nixpi.succeed(\"! /run/current-system/sw/bin/nixos-rebuild build --flake /etc/nixos#nixpi 2>&1 | grep -q 'Supported rebuilds require /srv/nixpi to be on main'\")
```

If direct `nixos-rebuild` failure is awkward to assert here, introduce a helper command or service-level check that exposes the same guard.

Add explicit fail-fast bootstrap assertions for pre-existing bad repo states:

```python
nixpi.succeed("rm -rf /srv/nixpi && install -d -o pi -g users /srv/nixpi && touch /srv/nixpi/not-a-repo")
nixpi.fail("systemctl start nixpi-firstboot.service")
nixpi.succeed("journalctl -u nixpi-firstboot.service -n 50 --no-pager | grep -q 'Proposal repo path exists but is not a git clone\\|canonical repo checkout is missing .git'")
```

and a wrong-origin case that proves first boot refuses an existing Git checkout whose `origin` does not match the configured remote.

- [ ] **Step 2: Run the first-boot test and confirm it fails**

Run: `nix build .#checks.x86_64-linux.smoke-firstboot --no-link`

Expected: FAIL because the generated checkout and metadata still point at the home path and the branch guard is not enforced.

- [ ] **Step 3: Update `firstboot.nix` to create `/srv/nixpi` and validate it**

Replace the current repo target and metadata writes with `/srv/nixpi` and `/etc/nixpi/canonical-repo.json`. Before cloning, make `/srv/nixpi` writable for the primary user:

```bash
install -d -m 0755 /srv
install -d -o "$primary_user" -g "$primary_user" -m 0755 /srv/nixpi
```

If cloning must happen as the primary user, use `su - "$primary_user" -c 'git clone ... /srv/nixpi'` or the existing helper pattern rather than cloning as root and fixing ownership later.

Make the pre-existing checkout validation explicit and fail-fast:

```bash
if [ -e /srv/nixpi ] && [ ! -d /srv/nixpi/.git ]; then
  echo "canonical repo checkout is missing .git: /srv/nixpi" >&2
  exit 1
fi

actual_remote="$(git -C /srv/nixpi remote get-url origin 2>/dev/null || true)"
if [ -n "$actual_remote" ] && [ "$actual_remote" != "$remote_url" ]; then
  echo "canonical repo origin mismatch: expected $remote_url, got ${actual_remote:-<missing>}" >&2
  exit 1
fi
```

Apply the same strictness to wrong-branch validation during bootstrap if the checkout already exists and is not on the configured default branch.

Generate `/etc/nixos/flake.nix` as a tiny flake that imports host-local config and points at `/srv/nixpi` for generic NixPI code.

The generated host flake should look structurally like the real flake patterns already in `flake.nix`, not a fictional helper. Use the actual output shape from this repo when writing the host shim.

```nix
{
  inputs.nixpi.url = "path:/srv/nixpi";

  outputs = { self, nixpi, ... }: {
    nixosConfigurations.nixpi = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [
        ./nixpi-host.nix
        nixpi.nixosModules.nixpi
      ];
    };
  };
}
```

Keep the exact module list aligned with existing repo outputs, but preserve the invariant: `/etc/nixos/flake.nix` is tiny, host-only, and does not own the generic code.

- [ ] **Step 4: Add the supported-branch rebuild guard**

Enforce the `main`-only rebuild rule in the actual activation path, not just in helper scripts. The host flake should import a tiny guard module from `/srv/nixpi` or `/etc/nixos` that makes evaluation fail when the checkout is not on `main`:

```nix
assertions = [
  {
    assertion = builtins.readFile (pkgs.runCommand "nixpi-branch" {} ''
      ${pkgs.git}/bin/git -C /srv/nixpi branch --show-current > $out
    '') == "main\n";
    message = "Supported rebuilds require /srv/nixpi to be on main";
  }
];
```

If that exact shape is awkward, implement the equivalent as a small generated module or imported file evaluated by `/etc/nixos/flake.nix`. The key invariant is that direct `nixos-rebuild --flake /etc/nixos#nixpi` must fail even if callers bypass wrapper scripts.

Then keep matching shell-level checks before invoking rebuild in helper paths:

```bash
current_branch="$(git -C /srv/nixpi branch --show-current)"
if [ "$current_branch" != "main" ]; then
  echo "Supported rebuilds require /srv/nixpi to be on main" >&2
  exit 1
fi
```

Wire `setup-wizard.sh` guidance to explain:

```bash
cd /srv/nixpi
git switch main
sudo nixos-rebuild switch --flake /etc/nixos#nixpi
```

- [ ] **Step 5: Run the first-boot test again**

Run: `nix build .#checks.x86_64-linux.smoke-firstboot --no-link`

Expected: PASS

- [ ] **Step 6: Commit the first-boot layout and ownership change**

```bash
git add core/os/modules/firstboot.nix core/scripts/setup-wizard.sh tests/nixos/nixpi-firstboot.nix
git commit -m "feat(firstboot): bootstrap /srv/nixpi host layout"
```

### Task 4: Update Installer Bootstrap and Smoke Coverage

**Files:**
- Modify: `core/os/pkgs/installer/nixpi-installer.sh`
- Modify: `core/os/pkgs/installer/test_nixpi_installer.py`
- Modify: `tests/nixos/nixpi-installer-smoke.nix`

- [ ] **Step 1: Write failing installer tests for `/srv/nixpi` bootstrap**

In `core/os/pkgs/installer/test_nixpi_installer.py`, add or update cases asserting:

```python
assert checkout_dir == "/srv/nixpi"
assert metadata_path == "/etc/nixpi/canonical-repo.json"
```

For the smoke test, assert the installed target does not pre-create a competing repo in `/home/<user>/nixpi` and that `/etc/nixos/flake.nix` stays absent until first boot if that is still the intended boot flow.

- [ ] **Step 2: Run the targeted installer tests and confirm failure**

Run:

```bash
nix shell nixpkgs#python3Packages.pytest -c pytest core/os/pkgs/installer/test_nixpi_installer.py -q
nix build .#checks.x86_64-linux.installer-smoke --no-link
```

Expected: FAIL because the installer/test expectations still assume the old checkout model.

- [ ] **Step 3: Update installer scripts and messages**

Make the installer write or advertise the `/srv/nixpi` checkout model. If the clone still occurs during first boot rather than in the installer itself, keep that behavior but make every installer-facing path and artifact reference the new canonical repo location.

Replace guidance like:

```bash
echo "Edit ~/nixpi and rebuild from there"
```

with:

```bash
echo "Edit /srv/nixpi and rebuild through /etc/nixos from main"
```

- [ ] **Step 4: Run the targeted installer tests again**

Run:

```bash
nix shell nixpkgs#python3Packages.pytest -c pytest core/os/pkgs/installer/test_nixpi_installer.py -q
nix build .#checks.x86_64-linux.installer-smoke --no-link
```

Expected: PASS

- [ ] **Step 5: Commit the installer/bootstrap updates**

```bash
git add core/os/pkgs/installer/nixpi-installer.sh core/os/pkgs/installer/test_nixpi_installer.py tests/nixos/nixpi-installer-smoke.nix
git commit -m "feat(installer): align bootstrap with /srv/nixpi layout"
```

### Task 5: Align Update, Broker, Daemon, and Agent Operations With the New Invariant

**Files:**
- Modify: `core/os/modules/update.nix`
- Modify: `core/os/modules/broker.nix`
- Modify: `core/os/services/nixpi-daemon.nix`
- Modify: `core/scripts/system-update.sh`
- Modify: `core/pi/extensions/os/actions.ts`
- Modify: `core/pi/extensions/os/actions-proposal.ts`
- Modify: `core/pi/extensions/nixpi/actions.ts`
- Modify: `tests/nixos/nixpi-update.nix`
- Modify: `tests/nixos/nixpi-daemon.nix`

- [ ] **Step 1: Write failing assertions for update and daemon repo usage**

Update `tests/nixos/nixpi-daemon.nix` to assert:

```python
assert "NIXPI_DIR=/srv/nixpi" in environment
assert working_directory == "/srv/nixpi"
```

Update `tests/nixos/nixpi-update.nix` to assert:

```python
machine.succeed("test -f /etc/nixos/flake.nix")
machine.fail("test -d /home/pi/nixpi")
```

Add coverage for the `main`-only rebuild contract in every supported update path. At minimum, add targeted tests or assertions for:

```text
- broker-driven nixos-update apply
- system-update.sh
- any surfaced OS action that recommends or triggers rebuild
```

Add any missing targeted unit or integration checks for user-facing error messages that should now mention `/srv/nixpi` and rebuilding from `main`.

- [ ] **Step 2: Run the targeted tests and confirm failure**

Run:

```bash
nix build .#checks.x86_64-linux.nixos-full --no-link
```

If that lane is too heavy for tight iteration, run the narrowest checks that exercise the updated modules first and only then re-run `nixos-full`.

Expected: FAIL because daemon/update behavior and messages still mention the home checkout.

- [ ] **Step 3: Implement the minimal service and action changes**

Update service environments, working directories, and operator-facing messages to use:

```nix
WorkingDirectory = "/srv/nixpi";
Environment = [ "NIXPI_DIR=/srv/nixpi" "NIXPI_SYSTEM_FLAKE_DIR=/etc/nixos" ];
```

Also add the same branch guard to all supported rebuild/update entrypoints, including:

```bash
git -C /srv/nixpi branch --show-current
```

in `core/scripts/system-update.sh`, and the broker-controlled `nixos-update apply` path in `core/os/modules/broker.nix`.

Do not rely on these wrappers alone. Their job is to surface friendlier errors early; the activation-time guard added in Task 3 remains the source of truth.

Update TS actions so any surfaced commands or errors align with:

```ts
"Edit /srv/nixpi, switch to main, then rebuild with sudo nixos-rebuild switch --flake /etc/nixos#nixpi"
```

Do not re-open proposal-path semantics here unless Task 1 left a deliberate follow-up.

- [ ] **Step 4: Run the targeted tests again**

Run the narrow checks first, then:

```bash
nix build .#checks.x86_64-linux.nixos-full --no-link
```

Expected: PASS

- [ ] **Step 5: Commit the runtime/alignment changes**

```bash
git add core/os/modules/update.nix core/os/modules/broker.nix core/os/services/nixpi-daemon.nix core/scripts/system-update.sh core/pi/extensions/os/actions.ts core/pi/extensions/nixpi/actions.ts tests/nixos/nixpi-update.nix tests/nixos/nixpi-daemon.nix
git commit -m "refactor: align runtime operations with /srv/nixpi"
```

### Task 6: Rewrite Docs and Publish the Explicit Migration Path

**Files:**
- Modify: `docs/install.md`
- Modify: `docs/operations/quick-deploy.md`
- Modify: `docs/operations/first-boot-setup.md`
- Modify: `docs/operations/index.md`
- Modify: `docs/architecture/runtime-flows.md`
- Create: `docs/operations/migrating-to-srv-nixpi.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Write the migration doc first**

Create `docs/operations/migrating-to-srv-nixpi.md` with the explicit cutover order:

```md
1. Ensure `/srv/nixpi` is a clean clone of the intended remote.
2. Copy or re-clone any in-flight work from `/home/$USER/nixpi`.
3. Switch `/srv/nixpi` to `main`.
4. Regenerate or verify `/etc/nixos/flake.nix`.
5. Rebuild with `sudo nixos-rebuild switch --flake /etc/nixos#nixpi`.
6. Remove or archive legacy repo copies only after verification.
```

Include a warning that proposal/apply clones are no longer supported as source-of-truth repos.

- [ ] **Step 2: Rewrite the operator docs around the new model**

Update every doc to use the same canonical guidance:

```md
- Edit generic code in `/srv/nixpi`
- Keep host-local machine config in `/etc/nixos`
- Rebuild only from `main`
- Use `sudo nixos-rebuild switch --flake /etc/nixos#nixpi`
```

Remove or rewrite references to:

```md
~/nixpi
~/.nixpi/pi-nixpi
/var/lib/nixpi/pi-nixpi
```

- [ ] **Step 3: Resolve the `AGENTS.md` conflict deliberately**

Update `AGENTS.md` only if the repository’s own contributor workflow is intended to follow the product’s `/srv/nixpi` runtime rule. If local repo-development on this workstation should still happen in `/home/alex/nixpi`, add an explicit note clarifying the difference between:

```md
- repository-development workspace on this machine: /home/alex/nixpi
- product runtime canonical repo on installed systems: /srv/nixpi
```

Do not leave the current contradiction in place.

- [ ] **Step 4: Review doc consistency with a search pass**

Run:

```bash
rg -n "/home/\\$USER/nixpi|~/nixpi|~/.nixpi/pi-nixpi|/var/lib/nixpi/pi-nixpi" docs core tests AGENTS.md
```

Expected: only intentionally preserved references remain, such as migration guidance or superseded design docs.

- [ ] **Step 5: Commit the docs and migration changes**

```bash
git add docs/install.md docs/operations/quick-deploy.md docs/operations/first-boot-setup.md docs/operations/index.md docs/architecture/runtime-flows.md docs/operations/migrating-to-srv-nixpi.md AGENTS.md
git commit -m "docs: document /srv/nixpi single-repo workflow"
```

### Task 7: Final Verification and Integration Check

**Files:**
- Modify: none
- Verify: repo-wide

- [ ] **Step 1: Run the targeted fast checks**

Run:

```bash
nix shell nixpkgs#nodejs -c npm test -- tests/lib/filesystem.test.ts
nix shell nixpkgs#nodejs -c npm test -- tests/extensions/os-proposal.test.ts
nix shell nixpkgs#nodejs -c npm test -- tests/extensions/os-update.test.ts
nix shell nixpkgs#nodejs -c npm test -- tests/extensions/os.test.ts
nix shell nixpkgs#python3Packages.pytest -c pytest core/os/pkgs/installer/test_nixpi_installer.py -q
```

Expected: PASS

- [ ] **Step 2: Run the key NixOS checks**

Run:

```bash
nix build .#checks.x86_64-linux.smoke-firstboot --no-link
nix build .#checks.x86_64-linux.installer-smoke --no-link
nix build .#checks.x86_64-linux.config --no-link
```

Expected: PASS

- [ ] **Step 3: Run the broader integration lane**

Run:

```bash
nix build .#checks.x86_64-linux.nixos-full --no-link
```

Expected: PASS

- [ ] **Step 4: Inspect for unintended legacy-path regressions**

Run:

```bash
rg -n "/home/\\$USER/nixpi|~/nixpi|~/.nixpi/pi-nixpi|/var/lib/nixpi/pi-nixpi" core tests docs AGENTS.md
git status --short
```

Expected: only migration/superseded-doc references remain, and the working tree contains only intended changes.

- [ ] **Step 5: Create the integration commit**

```bash
git add -A
git commit -m "feat: adopt /srv/nixpi single-repo architecture"
```
