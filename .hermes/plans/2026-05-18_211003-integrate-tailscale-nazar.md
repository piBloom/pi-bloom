# Integrate Tailscale Into Nazar Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task. For the implementation and independent reviews, use Codex CLI from a git checkout with `pty=true`, never `--impure`, and keep changes declarative.

**Goal:** Add Tailscale to the Nazar NixOS server so private services such as Life OS CalDAV/WebDAV and Hermes Dashboard can be consumed from normal phone/desktop apps over a private tailnet instead of SSH tunnels or public HTTP exposure.

**Architecture:** Keep public exposure minimal: public firewall remains SSH-only, while private human-app access happens over `tailscale0`. Add a small declarative NixOS host module for Tailscale, import it in `nix/hosts/nazar/default.nix`, keep service exposure explicit, and document onboarding/verification. Do not store Tailscale auth keys or OAuth/client secrets in Nix; enrollment remains a one-time runtime step or uses a runtime secret file if automation is later desired.

**Tech Stack:** NixOS flakes, `services.tailscale`, NixOS firewall interface rules, systemd service checks, optional nginx/Radicale/WebDAV follow-up, Codex CLI for implementation/review.

---

## Current Context / Assumptions

Observed from `/home/alex/repos/nazar`:

- Canonical repo: `/home/alex/repos/nazar`.
- Branch: `main`.
- Remote: `codeberg git@codeberg.org:NazarStudio/Nazar.git`.
- Host config: `nix/hosts/nazar/default.nix` imports host modules including:
  - `../../modules/host/networking.nix`
  - `../../modules/host/firewall.nix`
  - `../../modules/host/hermes-dashboard.nix`
  - `../../modules/host/life-os.nix`
- Public SSH is intentionally the only public service:
  - `nix/modules/host/ssh.nix` opens TCP/22 only on the public NIC.
  - `runbooks/SSH_TUNNEL_ACCESS.md` states public firewall is SSH-only and browser services bind to host loopback.
- Existing firewall base:
  - `nix/modules/host/firewall.nix` enables firewall, allows ping, uses loose reverse path checking, and disables IP forwarding.
- Existing Life OS module:
  - `nix/modules/host/life-os.nix` currently only installs the Life OS CLI and creates `/srv/life` directories.
  - It does not currently define CalDAV/WebDAV services itself.
- Existing Hermes Dashboard:
  - `nix/modules/host/hermes-dashboard.nix` starts dashboard on `127.0.0.1:${port}` where the default port comes from `nix/fleet/exposure.nix` (`9119`).
- Existing laptop access:
  - `nix/modules/laptop/nazar-tunnel.nix` declares SSH local forwards, currently defaulting to local `127.0.0.1:9119 -> nazar 127.0.0.1:9119`.

Assumptions for this plan:

- Use vanilla Tailscale first, not NetBird or Headscale.
- Tailscale coordination/account login is acceptable initially; Headscale can be a later migration if desired.
- Public DAV exposure is out of scope and should remain forbidden by default.
- We are planning Tailscale integration first; actual CalDAV/WebDAV service module hardening can be a follow-up if not already implemented elsewhere.
- The user prefers NixOS declarative, KISS/YAGNI, and no impure Nix commands.

---

## Proposed Approach

1. Add a reusable Nazar host module: `nix/modules/host/tailscale.nix`.
2. Enable `services.tailscale` declaratively.
3. Open only what Tailscale itself needs on the public NIC via the NixOS module option, not broad public service ports.
4. Allow private service ports explicitly on `tailscale0`, initially:
   - TCP/80 and TCP/443 for private nginx/DAV once available.
   - Optionally TCP/9119 for direct Hermes Dashboard only if we deliberately choose to expose it over tailnet without nginx; otherwise keep dashboard loopback-only and put an authenticated private reverse proxy in front later.
5. Keep `networking.firewall.trustedInterfaces` unset; do not trust all tailnet traffic by default.
6. Add assertions/evaluation checks so future changes do not accidentally remove Tailscale or open public DAV ports.
7. Update runbooks to describe:
   - one-time `sudo tailscale up --ssh=false --hostname=nazar` enrollment,
   - client app usage via Tailscale/MagicDNS,
   - verification commands,
   - how SSH tunnels relate to the new access path.
8. Use Codex for implementation and at least two reviews:
   - implementation Codex run,
   - spec-compliance Codex review,
   - security/NixOS-quality Codex review.

---

## Desired End State

After deploy:

- `tailscaled.service` is enabled and active on Nazar.
- Public network exposure remains SSH-only plus Tailscale's UDP control/listen path as required by `services.tailscale.openFirewall`.
- No TCP/80 or TCP/443 is opened on the public NIC unless a separate explicit public-service change is made later.
- `tailscale0` permits the selected private HTTP(S) ports.
- Phone/laptop clients connected to the tailnet can reach private Nazar services by MagicDNS or tailnet IP.
- The runbook explains exactly how to enroll Nazar, install clients, and configure CalDAV/WebDAV apps.

---

## Step-by-Step Plan

### Task 1: Create a Git branch for the work

**Objective:** Keep the implementation isolated and reviewable.

**Files:** none expected.

**Commands:**

```bash
cd /home/alex/repos/nazar
git status --short
git switch -c feat/tailscale-private-access
```

**Expected:**

- Working tree is clean before starting, except this plan file if not committed separately.
- New branch `feat/tailscale-private-access` exists.

**Codex note:** If this plan file is untracked, decide whether to commit it first as `docs: add tailscale integration plan` or leave it untracked outside the implementation branch. Do not let Codex overwrite unrelated work.

---

### Task 2: Add `nix/modules/host/tailscale.nix`

**Objective:** Enable Tailscale declaratively and expose only explicitly approved private tailnet ports.

**Files:**

- Create: `nix/modules/host/tailscale.nix`

**Implementation shape:**

```nix
{ lib, ... }:
let
  tailnetInterface = "tailscale0";
in
{
  services.tailscale = {
    enable = true;

    # Opens the UDP port Tailscale needs on the public firewall. This should not
    # expose Nazar's HTTP/DAV services publicly.
    openFirewall = true;

    # Avoid advertising Nazar as an exit node/router unless explicitly planned.
    useRoutingFeatures = lib.mkDefault "client";
  };

  networking.firewall.interfaces.${tailnetInterface}.allowedTCPPorts = [
    # Private HTTP(S) entrypoint for DAV/dashboard once nginx virtual hosts exist.
    80
    443
  ];

  assertions = [
    {
      assertion = !(builtins.elem tailnetInterface (config.networking.firewall.trustedInterfaces or [ ]));
      message = "Do not mark tailscale0 as a fully trusted firewall interface; expose only explicit private ports.";
    }
  ];
}
```

**Important correction for Codex:** The above snippet references `config` but the argument list currently lacks `config`. The final file must be syntactically valid, e.g.:

```nix
{
  config,
  lib,
  ...
}:
let
  tailnetInterface = "tailscale0";
in
{
  services.tailscale = {
    enable = true;
    openFirewall = true;
    useRoutingFeatures = lib.mkDefault "client";
  };

  networking.firewall.interfaces.${tailnetInterface}.allowedTCPPorts = [
    80
    443
  ];

  assertions = [
    {
      assertion = !(builtins.elem tailnetInterface (config.networking.firewall.trustedInterfaces or [ ]));
      message = "Do not mark tailscale0 as a fully trusted firewall interface; expose only explicit private ports.";
    }
  ];
}
```

**Design notes:**

- Do not set `networking.firewall.trustedInterfaces = [ "tailscale0" ];`.
- Do not enable subnet routes, exit-node behavior, or IP forwarding.
- Do not place auth keys in Nix.
- If NixOS option names differ on the pinned nixpkgs, Codex should verify by evaluation and adjust to the correct upstream option without using `--impure`.

**Verification:**

```bash
nixfmt nix/modules/host/tailscale.nix
```

Expected: format succeeds.

---

### Task 3: Import the Tailscale host module

**Objective:** Wire the new module into the Nazar host configuration.

**Files:**

- Modify: `nix/hosts/nazar/default.nix`

**Change:** Add the new module to the imports list, close to networking/firewall modules:

```nix
    ../../modules/host/networking.nix
    ../../modules/host/tailscale.nix
    ../../modules/host/firewall.nix
```

**Verification:**

```bash
nixfmt nix/hosts/nazar/default.nix
```

Expected: format succeeds.

---

### Task 4: Add host eval checks for Tailscale

**Objective:** Make regressions visible in `nix flake check`.

**Files:**

- Modify: `flake.nix`

**Current relevant check:** `checks.${system}.nazar-host-module-eval` already emits files for OpenSSH and Hermes Dashboard state.

**Change:** Extend `nazar-host-module-eval` to write additional check files, such as:

```nix
          echo ${toString self.nixosConfigurations.nazar.config.services.tailscale.enable} > $out/tailscale-enabled
          echo ${toString self.nixosConfigurations.nazar.config.services.tailscale.openFirewall} > $out/tailscale-open-firewall
          echo ${
            toString (
              nixpkgs.lib.elem 443 (
                self.nixosConfigurations.nazar.config.networking.firewall.interfaces.tailscale0.allowedTCPPorts or [ ]
              )
            )
          } > $out/tailscale-private-https-allowed
```

Potential additional checks:

```nix
          echo ${
            toString (
              !(nixpkgs.lib.elem "tailscale0" (
                self.nixosConfigurations.nazar.config.networking.firewall.trustedInterfaces or [ ]
              ))
            )
          } > $out/tailscale-not-trusted-interface
```

**Verification:**

```bash
nixfmt flake.nix
nix flake check --no-build
```

Expected:

- Evaluation succeeds.
- No impure flags used.

---

### Task 5: Add deployment/runtime runbook for Tailscale

**Objective:** Document one-time enrollment and daily usage so phone/desktop app setup is repeatable.

**Files:**

- Create: `runbooks/TAILSCALE_PRIVATE_ACCESS.md`
- Modify: `README.md` if it has a runbook index.
- Possibly modify: `runbooks/SSH_TUNNEL_ACCESS.md` to mention Tailscale as the preferred app-sync path while SSH tunnel remains the admin fallback.

**Runbook content should include:**

1. Purpose:
   - private CalDAV/WebDAV/Hermes access over tailnet,
   - no public DAV exposure.
2. Deployment:

```bash
cd /home/alex/repos/nazar
nix flake check --no-build
nix build .#nixosConfigurations.nazar.config.system.build.toplevel
sudo nixos-rebuild switch --flake .#nazar
```

3. One-time server enrollment:

```bash
sudo tailscale up --hostname=nazar --ssh=false
```

Notes:

- `--ssh=false` avoids enabling Tailscale SSH until explicitly desired.
- Complete browser/device login through the chosen Tailscale account.
- Do not paste auth keys into Nix files.

4. Server verification:

```bash
systemctl is-active tailscaled
sudo tailscale status
sudo tailscale ip -4
sudo tailscale ip -6
```

5. Firewall verification:

```bash
sudo nft list ruleset | grep -i tailscale -A5 -B5 || true
```

6. Client setup:
   - Install Tailscale on iOS/Android/laptop.
   - Join same tailnet.
   - Enable MagicDNS in Tailscale admin if desired.
   - Use `https://nazar.<tailnet>.ts.net/` or the MagicDNS hostname once HTTPS/private nginx is configured.

7. App pointers:
   - iOS: Apple Calendar/Reminders for CalDAV, WebDAV-capable file app for files.
   - Android: DAVx⁵ + Tasks.org + Etar/Google Calendar.
   - Desktop: Thunderbird.

8. HTTPS note:
   - For CalDAV/WebDAV clients, HTTPS is strongly preferred.
   - Tailscale certs require Tailscale HTTPS/cert support enabled in the tailnet and a runtime command such as `tailscale cert <machine>.<tailnet>.ts.net`.
   - Certificate automation should be designed separately so private keys are stored under `/var/lib` or another runtime path, not the Nix store.

9. Rollback:

```bash
sudo tailscale down
sudo systemctl stop tailscaled
# then switch to a previous NixOS generation if needed
```

**Verification:**

```bash
markdownlint runbooks/TAILSCALE_PRIVATE_ACCESS.md || true
```

If the repo has no markdown linter, skip and manually review formatting.

---

### Task 6: Update SSH tunnel runbook without removing it

**Objective:** Preserve SSH tunnel as fallback/admin path while making Tailscale the recommended path for normal human apps.

**Files:**

- Modify: `runbooks/SSH_TUNNEL_ACCESS.md`

**Change:** Add a short section near the top:

```markdown
## Relationship To Tailscale

SSH local forwarding remains the fallback/admin path. For phone/desktop apps that need persistent CalDAV/WebDAV sync, prefer Tailscale private access; mobile CalDAV/WebDAV clients generally cannot use SSH tunnels reliably for background sync.
```

**Verification:** manually read the runbook and ensure it no longer implies SSH tunnels are the only possible private access path.

---

### Task 7: Decide how to expose Hermes Dashboard over tailnet

**Objective:** Avoid accidentally exposing an unauthenticated dashboard to every tailnet peer.

**Files:**

- Inspect/possibly modify: `nix/modules/host/hermes-dashboard.nix`
- Possibly create later: `nix/modules/host/private-nginx.nix` or integrate into a DAV/nginx module.

**Recommended decision for initial implementation:**

- Do not change Hermes Dashboard binding in this task.
- Keep it on `127.0.0.1:9119`.
- Keep SSH tunnel as the dashboard access path until there is a deliberate private reverse-proxy/auth story.
- Use Tailscale first for DAV/HTTP(S) endpoints that have explicit auth.

**Alternative if the user explicitly wants dashboard over Tailscale now:**

- Bind dashboard to a tailnet-only listener or reverse proxy it through nginx bound to `tailscale0`.
- Add authentication if the dashboard does not already require it.
- Add TCP/9119 to `networking.firewall.interfaces.tailscale0.allowedTCPPorts` only if direct access is chosen.

**Codex instruction:** Do not widen Hermes Dashboard binding from `127.0.0.1` to `0.0.0.0` as a drive-by change.

---

### Task 8: Prepare for Life OS DAV endpoint, but do not overbuild

**Objective:** Make clear what Tailscale unlocks and what remains for DAV-specific implementation.

**Files:**

- Possibly modify: `runbooks/TAILSCALE_PRIVATE_ACCESS.md`
- Possibly create a TODO section in existing Life OS docs if present.

**Clarify in docs:**

- Tailscale gives private network reachability.
- A CalDAV/WebDAV service still needs to be configured if it is not already active.
- Current `nix/modules/host/life-os.nix` only creates `/srv/life` and installs the CLI.
- A later DAV module should likely use:
  - `services.radicale` for CalDAV/VTODO,
  - nginx WebDAV module for file access,
  - private-only vhosts reachable via `tailscale0`,
  - auth/app passwords,
  - no public TCP/80/443.

**Verification:** docs accurately distinguish "network access" from "DAV service exists".

---

### Task 9: Run declarative validation

**Objective:** Verify the Nix changes without impurity.

**Commands:**

```bash
cd /home/alex/repos/nazar
nix fmt
nix flake check --no-build
nix build .#nixosConfigurations.nazar.config.system.build.toplevel --print-build-logs
```

Expected:

- Formatter succeeds.
- Flake check succeeds.
- Host toplevel builds.

**If new files are invisible to Git flakes:**

```bash
git add nix/modules/host/tailscale.nix runbooks/TAILSCALE_PRIVATE_ACCESS.md flake.nix nix/hosts/nazar/default.nix runbooks/SSH_TUNNEL_ACCESS.md
nix flake check --no-build
```

Do not use `--impure`.

---

### Task 10: Switch Nazar and verify live state

**Objective:** Apply and verify Tailscale is running on the server.

**Commands:**

```bash
cd /home/alex/repos/nazar
sudo nixos-rebuild switch --flake .#nazar
systemctl is-active tailscaled
systemctl status tailscaled --no-pager
```

If not yet enrolled:

```bash
sudo tailscale up --hostname=nazar --ssh=false
```

After enrollment:

```bash
sudo tailscale status
sudo tailscale ip -4
sudo tailscale ip -6
```

Expected:

- `tailscaled` active.
- `tailscale status` shows Nazar in the tailnet.
- Tailnet IP exists.

---

### Task 11: Client-side smoke test

**Objective:** Confirm a laptop or phone can reach Nazar over the tailnet.

**From a tailnet-connected laptop:**

```bash
tailscale status
tailscale ping nazar
curl -v http://<nazar-tailnet-ip>/
```

Expected:

- `tailscale ping nazar` succeeds.
- HTTP may fail until a private HTTP service exists; if it fails, document whether the failure is expected because no service is listening.

**If nginx/private DAV exists later:**

```bash
curl -I https://nazar.<tailnet>.ts.net/
```

Expected:

- HTTP status from the configured private service.

---

### Task 12: Commit and push

**Objective:** Preserve the declarative change in the canonical repo.

**Commands:**

```bash
cd /home/alex/repos/nazar
git status --short
git diff --stat
git add nix/modules/host/tailscale.nix nix/hosts/nazar/default.nix flake.nix runbooks/TAILSCALE_PRIVATE_ACCESS.md runbooks/SSH_TUNNEL_ACCESS.md README.md
git commit -m "feat: add tailscale private access for nazar"
git push -u codeberg feat/tailscale-private-access
```

Then open a PR/merge request if that is the current workflow, or merge to `main` after review.

---

## Codex Implementation And Review Workflow

### Pre-flight

Run these before Codex:

```bash
cd /home/alex/repos/nazar
git status --short
codex --version
```

If `codex --version` fails, install/configure Codex before proceeding. Codex must run inside the git repo with `pty=true`.

### Implementation prompt

Run Codex in a branch/worktree:

```bash
codex exec --full-auto '
Implement the plan in .hermes/plans/2026-05-18_211003-integrate-tailscale-nazar.md.

Constraints:
- NixOS declarative changes only.
- Do not use --impure anywhere.
- Do not expose CalDAV/WebDAV publicly.
- Do not set networking.firewall.trustedInterfaces = [ "tailscale0" ].
- Do not store Tailscale auth keys or secrets in Nix.
- Keep Hermes Dashboard bound to 127.0.0.1 unless the plan explicitly says otherwise.
- Add/modify runbooks as described.
- Run nix fmt, nix flake check --no-build, and build the nazar toplevel if available.
- Commit changes with a clear message if all checks pass.
'
```

Hermes terminal call shape for execution later:

```python
terminal(
  command="codex exec --full-auto '...prompt above...'",
  workdir="/home/alex/repos/nazar",
  pty=True,
  background=True,
  notify_on_complete=True,
)
```

### Spec-compliance review prompt

After implementation, run a separate Codex review:

```bash
codex exec '
Review the current diff against .hermes/plans/2026-05-18_211003-integrate-tailscale-nazar.md for SPEC COMPLIANCE ONLY.

Check:
- Is services.tailscale enabled declaratively?
- Is public exposure still minimal?
- Are only explicit ports allowed on tailscale0?
- Is tailscale0 not globally trusted?
- Are secrets/auth keys absent from Nix/store-bound files?
- Are runbooks clear and complete?
- Were verification checks added?

Output PASS or a precise list of required fixes. Do not modify files.
'
```

### Security/NixOS-quality review prompt

Run another independent review:

```bash
codex exec '
Review the current diff for NixOS quality and security.

Focus on:
- accidental public TCP/80/443 exposure,
- broad firewall trust,
- Tailscale SSH accidentally enabled,
- routing/exit-node/subnet-router behavior accidentally enabled,
- secrets in the Nix store,
- invalid or obsolete NixOS options,
- missing host toplevel evaluation,
- docs that imply CalDAV/WebDAV exists if only Tailscale was added.

Output Critical Issues, Important Issues, Minor Issues, and Verdict APPROVED or REQUEST_CHANGES. Do not modify files.
'
```

### Fix loop

If either review requests changes:

1. Run Codex with a narrow fix prompt containing only the requested fixes.
2. Re-run `nix fmt`, `nix flake check --no-build`, and host toplevel build.
3. Re-run both reviews.
4. Do not merge until both reviews approve.

---

## Files Likely To Change

Expected:

- `nix/modules/host/tailscale.nix` — new Tailscale host module.
- `nix/hosts/nazar/default.nix` — import new module.
- `flake.nix` — evaluation checks for Tailscale state.
- `runbooks/TAILSCALE_PRIVATE_ACCESS.md` — new runbook.
- `runbooks/SSH_TUNNEL_ACCESS.md` — clarify SSH tunnel vs Tailscale roles.
- `README.md` — optional runbook index update.

Possible later/follow-up, not required for initial Tailscale integration:

- `nix/modules/host/life-os-dav.nix` or similar — private Radicale/WebDAV service.
- `nix/modules/host/private-nginx.nix` — private HTTPS reverse proxy over tailnet.
- `nix/fleet/exposure.nix` — private service port metadata if we want a shared source of truth.
- `nix/hosts/alex-laptop/default.nix` — laptop Tailscale module if this repo also manages the laptop tailnet client.

---

## Tests / Validation

### Static/eval validation

```bash
nix fmt
nix flake check --no-build
nix build .#nixosConfigurations.nazar.config.system.build.toplevel --print-build-logs
```

### Git/diff review

```bash
git diff --stat
git diff -- nix/modules/host/tailscale.nix nix/hosts/nazar/default.nix flake.nix runbooks
```

### Live service validation after switch

```bash
systemctl is-active tailscaled
systemctl status tailscaled --no-pager
sudo tailscale status
sudo tailscale ip -4
```

### Firewall validation

```bash
sudo nft list ruleset | grep -i tailscale -A5 -B5 || true
```

Check manually that public HTTP(S) is not opened by the NixOS firewall unless a separate public-service module explicitly does it.

### Client validation

From laptop/phone on tailnet:

```bash
tailscale ping nazar
```

If a private HTTP(S) service is configured:

```bash
curl -I https://nazar.<tailnet>.ts.net/
```

---

## Risks, Tradeoffs, And Open Questions

### Risks

- **False sense of completion:** Tailscale provides private network reachability; it does not itself implement CalDAV/WebDAV. If DAV is not active yet, clients still need a DAV service module.
- **Overbroad tailnet trust:** Marking `tailscale0` trusted would expose every listening service to every tailnet peer. Avoid this.
- **Dashboard exposure:** Hermes Dashboard may not be safe to expose directly to all tailnet peers. Keep loopback-only until auth/reverse-proxy design is explicit.
- **Secrets in Nix store:** Tailscale auth keys and certificate private keys must not be embedded in Nix expressions.
- **Mobile background behavior:** Tailscale is generally good on mobile, but background sync reliability depends on OS settings and Tailscale client configuration.

### Tradeoffs

- **Tailscale SaaS vs self-hosted:** Vanilla Tailscale is the fastest reliable path. Headscale/NetBird give more control but add operational complexity.
- **HTTP over tailnet vs HTTPS:** Tailnet traffic is encrypted, but CalDAV/WebDAV clients behave better with HTTPS. Plan for Tailscale certs or private ACME later.
- **Keep SSH tunnel:** SSH tunnel remains a useful admin fallback, but not the right default for phone CalDAV/WebDAV sync.

### Open Questions

1. What tailnet name/MagicDNS hostname should docs use? Use placeholders until known.
2. Should Nazar enable Tailscale SSH later, or keep OpenSSH as the only SSH path? Initial plan says keep Tailscale SSH disabled.
3. Should laptop Tailscale client configuration also be declared in this repo for `alex-laptop`?
4. Should private HTTPS cert generation be automated now, or handled manually after initial tailnet enrollment?
5. Is the Life OS DAV service already implemented elsewhere/live, or should a follow-up plan add Radicale + nginx WebDAV declaratively?

---

## Implementation Completion Criteria

This work is complete when:

- A Tailscale module is declaratively imported by Nazar.
- `nix flake check --no-build` passes.
- Nazar host toplevel builds.
- Runbooks document enrollment, client usage, verification, and rollback.
- Public exposure remains minimal.
- Codex implementation and two independent Codex reviews have passed, or any requested changes have been fixed and re-reviewed.
- After deployment, `tailscaled` is active and Nazar appears in `tailscale status`.
