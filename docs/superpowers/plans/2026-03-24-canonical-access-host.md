# Canonical NetBird Host Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the NetBird-assigned hostname the single canonical operator-facing address for Home, Element Web, and Matrix, while preserving `http://localhost/` as an explicit on-box degraded-mode recovery entry point.

**Architecture:** Rework the existing service-surface gateway instead of adding a new subsystem. The gateway should own both the canonical HTTPS host and the localhost recovery entry point, while Home runtime generation, Element config generation, and setup output all derive from one hostname-discovery path and stop presenting raw ports, mesh IPs, or localhost as equal normal access choices.

**Tech Stack:** NixOS modules (Nix), nginx reverse proxy, static-web-server services, bash setup scripts, NetBird CLI JSON status, Continuwuity Matrix endpoints, NixOS VM tests.

---

## File Structure

### Existing files to modify

- `core/os/modules/service-surface.nix`
  Own the gateway behavior. This is the right place to change canonical-host routing, TLS assumptions, nginx locations, and localhost degraded-mode entry behavior.
- `core/os/modules/options.nix`
  Rename or clarify service-surface option descriptions so they match the new model and stop implying that port `8443` is the main user-facing concept.
- `core/os/services/nixpi-home.nix`
  Update the built-in fallback Home HTML so it presents one canonical host story, not separate local vs remote models.
- `core/os/services/home-template.html`
  Update the richer generated Home page to present only the canonical NetBird hostname in healthy mode and explicit `localhost` recovery messaging in degraded mode.
- `core/scripts/setup-lib.sh`
  Consolidate runtime hostname discovery and generated URLs for Home and Element config. This is already where NetBird FQDN/IP detection and service runtime file generation live.
- `core/scripts/setup-wizard.sh`
  Update printed access guidance so the wizard stops advertising mesh IPs, direct ports, and localhost as normal remote choices.
- `core/pi/skills/builtin-services/SKILL.md`
  Align the operator-facing skill guidance with the new canonical host model.
- `docs/operations/first-boot-setup.md`
  Remove dual-primary access language from the setup docs.
- `docs/reference/infrastructure.md`
  Update NetBird and service-surface documentation so the public docs match the new canonical address story.

### Existing tests to modify

- `tests/nixos/nixpi-home.nix`
  Primary end-to-end coverage for generated Home content, Element config, localhost entry point, and secure gateway behavior.
- `tests/nixos/nixpi-modular-services.nix`
  Lower-level service registration and gateway smoke test.
- `tests/nixos/nixpi-security.nix`
  Confirm firewall exposure still matches the intended ports after gateway changes.
- `tests/nixos/default.nix`
  Register any new NixOS test if the canonical-host behavior needs its own dedicated test instead of only extending existing ones.

### Optional new test

- `tests/nixos/nixpi-canonical-access.nix`
  Add only if extending `nixpi-home.nix` and `nixpi-modular-services.nix` would become too awkward. Prefer reusing the existing service-surface tests unless isolation clearly improves readability.

---

### Task 1: Lock the Canonical Access Contract in Tests

**Files:**
- Modify: `tests/nixos/nixpi-home.nix`
- Modify: `tests/nixos/nixpi-modular-services.nix`
- Modify: `tests/nixos/nixpi-security.nix`
- Optional Modify: `tests/nixos/default.nix`

- [ ] **Step 1: Write failing assertions for the new operator-facing contract**

Add assertions that reflect the approved spec:

```python
nixpi.succeed("grep -q 'https://nixpi-home-test' /etc/system-services/nixpi-home/webroot/index.html")
nixpi.fail("grep -q 'https://nixpi-home-test:8443' /etc/system-services/nixpi-home/webroot/index.html")
nixpi.fail("grep -q 'http://localhost:8081/' /etc/system-services/nixpi-home/webroot/index.html")
nixpi.fail("grep -q 'mesh IP' /etc/system-services/nixpi-home/webroot/index.html")
nixpi.wait_until_succeeds("curl -sf http://127.0.0.1/ | grep -q 'NixPI Home'", timeout=60)
nixpi.wait_until_succeeds(\"curl -skf https://127.0.0.1:8443/_matrix/client/versions | grep -q 'versions'\", timeout=60)
```

Also add a degraded-mode expectation that `http://127.0.0.1/` remains the local recovery entry point while the page explicitly labels it as recovery-only and does not replace the canonical identity with `localhost`.

- [ ] **Step 2: Run the targeted Home test and confirm it fails**

Run: `nix build .#checks.x86_64-linux.nixpi-home`

Expected: FAIL because the current Home content still advertises `localhost`, raw ports, and separate local/remote access guidance.

- [ ] **Step 3: Run the modular-services test and confirm it also fails on old assumptions**

Run: `nix build .#checks.x86_64-linux.nixpi-modular-services`

Expected: FAIL because the current gateway/template behavior still exposes the old `8443` and direct-port phrasing.

- [ ] **Step 4: If needed, add a dedicated canonical-access test shell**

If the assertions make the existing test unreadable, create `tests/nixos/nixpi-canonical-access.nix` as a focused service-surface test and register it in `tests/nixos/default.nix`.

- [ ] **Step 5: Commit the test-only change**

```bash
git add tests/nixos/nixpi-home.nix tests/nixos/nixpi-modular-services.nix tests/nixos/nixpi-security.nix tests/nixos/default.nix tests/nixos/nixpi-canonical-access.nix
git commit -m "test(service-surface): lock canonical NetBird access contract"
```

### Task 2: Rework the Gateway Around One Canonical Host

**Files:**
- Modify: `core/os/modules/service-surface.nix`
- Modify: `core/os/modules/options.nix`

- [ ] **Step 1: Add failing assertions or evaluation checks for gateway shape**

Before editing behavior, add or extend assertions that describe the intended gateway contract:

```nix
assertions = [
  {
    assertion = cfg.home.enable -> cfg.secureWeb.enable;
    message = "Canonical hosted access requires nixpi.services.secureWeb.enable = true.";
  }
];
```

If the repo already has an option-validation test covering these options, extend that test first and make it fail before implementation.

- [ ] **Step 2: Implement canonical hostname routing in `service-surface.nix`**

Make these concrete changes:

```nix
secureWebCanonicalBaseUrl = "https://${canonicalHost}";

locations."/".proxyPass = "http://127.0.0.1:${toString cfg.home.port}";
locations."/element/".proxyPass = "http://127.0.0.1:${toString cfg.elementWeb.port}/";
locations."= /.well-known/matrix/client".return = ''
  200 '${builtins.toJSON { "m.homeserver".base_url = secureWebCanonicalBaseUrl; }}'
'';
locations."= /.well-known/matrix/server".return = ''
  200 '${builtins.toJSON { "m.server" = canonicalHost + ":443"; }}'
'';
locations."/_matrix".proxyPass = "http://127.0.0.1:${toString config.nixpi.matrix.port}";
```

Use one computed canonical host source instead of deriving URLs separately in multiple branches. Keep `http://localhost/` served by nginx as the degraded local entry point to Home.

- [ ] **Step 3: Remove the old “8443 as product surface” assumptions**

Update option descriptions and internal names/comments so the user-facing story is not “Element and Matrix live on port 8443”. Port `8443` can remain the implementation detail, but the docs and generated config should talk about the canonical HTTPS host instead.

- [ ] **Step 4: Run the targeted service-surface tests**

Run:

```bash
nix build .#checks.x86_64-linux.nixpi-home
nix build .#checks.x86_64-linux.nixpi-modular-services
```

Expected: PASS after the nginx routing and option behavior match the new contract.

- [ ] **Step 5: Commit the gateway change**

```bash
git add core/os/modules/service-surface.nix core/os/modules/options.nix
git commit -m "feat(service-surface): route services through canonical NetBird host"
```

### Task 3: Make Home and Element Runtime Config Derive From One Host Source

**Files:**
- Modify: `core/scripts/setup-lib.sh`
- Modify: `core/os/services/nixpi-home.nix`
- Modify: `core/os/services/home-template.html`
- Modify: `core/os/services/nixpi-element-web.nix`

- [ ] **Step 1: Write the failing test for generated runtime files**

Extend `tests/nixos/nixpi-home.nix` so it asserts generated runtime files use one canonical host model:

```python
nixpi.succeed("grep -q 'https://nixpi-home-test' /home/pi/.config/nixpi/services/element-web/config.json")
nixpi.fail("grep -q 'https://nixpi-home-test:8443' /home/pi/.config/nixpi/services/element-web/config.json")
nixpi.fail("grep -q 'http://localhost:6167' /home/pi/.config/nixpi/services/element-web/config.json")
nixpi.fail("grep -q 'Home direct port' /home/pi/.config/nixpi/services/home/index.html")
```

- [ ] **Step 2: Introduce one helper for canonical host discovery in `setup-lib.sh`**

Replace the current FQDN/IP-specific duplication with one function:

```bash
canonical_service_host() {
  local fqdn
  fqdn="$(netbird_fqdn)"
  if [[ -n "$fqdn" ]]; then
    printf '%s' "$fqdn"
    return
  fi
  return 1
}
```

Then derive:

```bash
page_url="http://localhost/"
canonical_https_url="https://${canonical_host}"
matrix_url="${canonical_https_url}"
element_web_url="${canonical_https_url}/element/"
```

If canonical host discovery fails, do not substitute `localhost` as the new canonical identity. Instead, preserve the last known canonical host if available or leave canonical-host fields explicitly unavailable so Home can render degraded-mode recovery messaging without switching identities.

- [ ] **Step 3: Update Home HTML content**

In both `nixpi-home.nix` and `home-template.html`, remove sections that present local vs remote as co-equal. Replace them with content shaped like:

```html
<p>Canonical access host</p>
<code>https://@@CANONICAL_HOST@@</code>
<p>If NetBird is unavailable on this machine, recover locally via <code>http://localhost/</code>.</p>
```

Keep the localhost page reachable, but make it clearly a degraded/recovery path.

- [ ] **Step 4: Update Element runtime config to use the canonical HTTPS host**

Ensure `config.json` generation always prefers the canonical host for `base_url`:

```json
{
  "default_server_config": {
    "m.homeserver": {
      "base_url": "https://<netbird-host>",
      "server_name": "<netbird-host>"
    }
  }
}
```

Do not rewrite `base_url` to `localhost` when canonical host discovery fails. Preserve canonical identity if known; otherwise generate degraded-state content that says canonical access is not ready yet.

- [ ] **Step 5: Run the Home test again**

Run: `nix build .#checks.x86_64-linux.nixpi-home`

Expected: PASS with updated runtime HTML and Element config assertions.

- [ ] **Step 6: Commit the runtime generation change**

```bash
git add core/scripts/setup-lib.sh core/os/services/nixpi-home.nix core/os/services/home-template.html core/os/services/nixpi-element-web.nix tests/nixos/nixpi-home.nix
git commit -m "feat(home): generate canonical NetBird host service links"
```

### Task 4: Update Wizard Output and Operator Guidance

**Files:**
- Modify: `core/scripts/setup-wizard.sh`
- Modify: `core/pi/skills/builtin-services/SKILL.md`
- Modify: `docs/operations/first-boot-setup.md`
- Modify: `docs/reference/infrastructure.md`

- [ ] **Step 1: Write the failing documentation assertions**

Use `rg` checks locally before editing so the unwanted patterns are explicit:

Run:

```bash
rg -n "mesh IP|localhost:8081|localhost:6167|NetBird hostname or mesh IP|Home direct port" \
  core/scripts/setup-wizard.sh \
  core/pi/skills/builtin-services/SKILL.md \
  docs/operations/first-boot-setup.md \
  docs/reference/infrastructure.md
```

Expected: matches found that represent the old dual-access language.

- [ ] **Step 2: Update wizard access output**

Make the wizard print one normal access story:

```bash
echo "  Canonical URL: https://${mesh_host}"
echo "  Local recovery: http://localhost/"
```

Do not print mesh IP and localhost direct ports as equivalent normal options.

- [ ] **Step 3: Update builtin-services skill and docs**

Rewrite those references to match the approved model:

- canonical NetBird hostname for normal browser and Matrix client access
- `http://localhost/` only for on-box recovery
- raw ports are implementation details or troubleshooting-only details

- [ ] **Step 4: Sanity-check the changed text**

Run:

```bash
rg -n "mesh IP|localhost:8081|localhost:6167|Home direct port" \
  core/scripts/setup-wizard.sh \
  core/pi/skills/builtin-services/SKILL.md \
  docs/operations/first-boot-setup.md \
  docs/reference/infrastructure.md
```

Expected: no matches for the removed operator-facing phrases unless they appear only in an explicitly labeled troubleshooting context.

- [ ] **Step 5: Commit the guidance changes**

```bash
git add core/scripts/setup-wizard.sh core/pi/skills/builtin-services/SKILL.md docs/operations/first-boot-setup.md docs/reference/infrastructure.md
git commit -m "docs(setup): align operator guidance with canonical NetBird host"
```

### Task 5: Verify Security and Recovery Behavior

**Files:**
- Modify: `tests/nixos/nixpi-security.nix`
- Modify: `tests/nixos/nixpi-home.nix`
- Modify: `tests/nixos/nixpi-modular-services.nix`

- [ ] **Step 1: Extend security assertions before implementation if still missing**

Add checks that ensure the gateway still preserves the expected exposed-port model:

```python
blocked_ports = [80, 6167, 8080, 8081, 5000, 8443]
steady.wait_until_succeeds("curl -sf http://127.0.0.1/ | grep -q 'NixPI Home'", timeout=60)
steady.wait_until_succeeds("curl -skf https://127.0.0.1:8443/_matrix/client/versions | grep -q 'versions'", timeout=60)
```

Keep asserting that external access remains gated to the trusted interface.

- [ ] **Step 2: Add an explicit degraded-mode fixture**

Create one concrete degraded-path scenario in either `tests/nixos/nixpi-home.nix` or a new `tests/nixos/nixpi-canonical-access.nix`:

```python
nixpi.succeed("NETBIRD_FAKE_NO_FQDN=1 su - pi -c 'setup-wizard.sh'")
nixpi.wait_until_succeeds("curl -sf http://127.0.0.1/ | grep -q 'Local recovery'", timeout=60)
nixpi.fail("curl -sf http://127.0.0.1/ | grep -q 'Canonical host: localhost'")
```

Implement the fixture with the smallest viable hook:

- environment override consumed by `setup-lib.sh`, or
- test-local wrapper around `netbird status --json`

The fixture must prove:

- canonical identity is not replaced with `localhost`
- Home shows recovery messaging only in degraded mode
- localhost entry remains available for on-box recovery

- [ ] **Step 3: Add one server-side Matrix discovery assertion**

In the same normal-path or degraded-path test, verify:

```python
nixpi.wait_until_succeeds("curl -skf https://127.0.0.1:8443/.well-known/matrix/client | grep -q 'm.homeserver'", timeout=60)
nixpi.wait_until_succeeds("curl -skf https://127.0.0.1:8443/.well-known/matrix/server | grep -q 'm.server'", timeout=60)
```

This ensures the gateway exposes the Matrix discovery shape required by the spec.

- [ ] **Step 4: Run the targeted security and recovery tests**

Run:

```bash
nix build .#checks.x86_64-linux.nixpi-security
nix build .#checks.x86_64-linux.nixpi-home
```

Expected: PASS with the same firewall/security model intact and the degraded-mode contract covered.

- [ ] **Step 5: Run all service-surface related tests together**

Run:

```bash
nix build .#checks.x86_64-linux.nixpi-home
nix build .#checks.x86_64-linux.nixpi-modular-services
nix build .#checks.x86_64-linux.nixpi-security
```

Expected: all PASS.

- [ ] **Step 6: Commit the verification-related test changes**

```bash
git add tests/nixos/nixpi-security.nix tests/nixos/nixpi-home.nix tests/nixos/nixpi-modular-services.nix tests/nixos/default.nix tests/nixos/nixpi-canonical-access.nix
git commit -m "test(security): cover canonical host and localhost recovery"
```

### Task 6: Final Verification and Cleanup

**Files:**
- Modify: only files already touched above

- [ ] **Step 1: Run formatting or repo-standard cleanup commands if required**

Run only the project-standard formatters needed for touched files. If there is no dedicated formatter for Nix or docs in this repo, skip this step and do not invent one.

- [ ] **Step 2: Run the full focused verification set**

Run:

```bash
nix build .#checks.x86_64-linux.nixpi-home
nix build .#checks.x86_64-linux.nixpi-modular-services
nix build .#checks.x86_64-linux.nixpi-security
```

If a dedicated `nixpi-canonical-access` test was added, run that too:

```bash
nix build .#checks.x86_64-linux.nixpi-canonical-access
```

Expected: all targeted checks PASS.

- [ ] **Step 3: Inspect the final diff for scope drift**

Run:

```bash
git status --short
git diff --stat HEAD~5..HEAD
```

Expected: changes limited to service-surface routing, runtime generation, docs/skill guidance, and the targeted tests.

- [ ] **Step 4: Create the final implementation commit if work was done without per-task commits**

```bash
git add core/os/modules/service-surface.nix core/os/modules/options.nix core/os/services/nixpi-home.nix core/os/services/home-template.html core/os/services/nixpi-element-web.nix core/scripts/setup-lib.sh core/scripts/setup-wizard.sh core/pi/skills/builtin-services/SKILL.md docs/operations/first-boot-setup.md docs/reference/infrastructure.md tests/nixos/nixpi-home.nix tests/nixos/nixpi-modular-services.nix tests/nixos/nixpi-security.nix tests/nixos/default.nix tests/nixos/nixpi-canonical-access.nix
git commit -m "feat(service-surface): standardize on canonical NetBird host access"
```

- [ ] **Step 5: Record verification results in the handoff**

Capture which tests passed, whether any optional test was added, and any remaining constraint such as:

- unified browser/mobile access still depends on a publicly trusted certificate for the NetBird hostname
- localhost remains a recovery-only local entry point, not a normal remote access path
