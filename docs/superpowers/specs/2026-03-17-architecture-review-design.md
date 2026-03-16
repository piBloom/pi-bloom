# Architecture Review — Red-Team Findings

Date: 2026-03-17
Scope: Personal deployment + public template responsibilities
Method: Attacker/failure persona walkthrough, Pareto-prioritized

---

## Context

Bloom is a NixOS-based personal AI-first OS. The primary security perimeter is a NetBird
WireGuard mesh network. All services (Matrix, Pi daemon, web services) are only accessible
from within the mesh. This is the intended and correct security model.

The review evaluated both the personal instance and the template's responsibilities to
downstream forkers who may deploy it without full security awareness.

---

## Security Model Assumption

**NetBird is the load-bearing security boundary.**

Everything behind the mesh is relatively trusted. The threat model is:

- Compromised mesh peer (device you own that gets compromised)
- Compromised service container already running on the host
- Template forker who deploys without NetBird or with it misconfigured

This is a simple, defensible model. The 20% of fixes below protect against 80% of
realistic threats within it.

---

## Pareto-Prioritized Findings

### Finding 1 — NetBird not documented as a hard security requirement

**Severity:** High

**What the problem is:**
NetBird is the perimeter. If it is not running, Matrix, Bloom Home (port 8080), dufs
(port 5000), code-server (port 8443), and the Matrix bridges are all exposed on the local
network and potentially beyond. Currently the setup docs present NetBird as a component to
configure, not as a security prerequisite that gates everything else.

**Blast radius for forkers:**
A forker who skips NetBird setup — or who misconfigures it — has no secondary containment.
The entire attack surface of Persona 1 (Matrix room participant → prompt injection → OS
tools) is wide open from any local network device.

**Proposed remediation:**
- Add a prominent security note to `docs/pibloom-setup.md` and `docs/quick_deploy.md`:
  "NetBird is not optional. It is the network security boundary for all Bloom services.
  Complete NetBird setup before exposing this machine to any network."
- Add a preflight check in the first-boot wizard that warns if NetBird is not active.
- Document the threat model explicitly: what is protected inside the mesh, what is not.

---

### Finding 2 — Default SSH password seeded in NixOS flake

**Severity:** High

**What the problem is:**
The NixOS configuration seeds `initialPassword = "bloom"` for the `pi` user to enable
first-boot SSH access. This is a known credential. Any compromised NetBird mesh peer — or
any host that gains mesh access — can SSH into the machine with this password.

The git history documents the intent (`fix: add initialPassword = "bloom" to pi user for
first-boot SSH access`), meaning this is an intentional setup convenience, not an oversight.
But it is not automatically rotated.

**Blast radius:**
Inside the mesh: a compromised peer device can pivot directly to the host via SSH.
For forkers: if NetBird is misconfigured or not set up, this is an internet-exposed
known-credential SSH endpoint.

**Proposed remediation (choose one or combine):**
- Force a mandatory password change on first interactive login (`chage -d 0 pi` or
  equivalent NixOS option).
- Generate a random initial password at image build time and surface it only at the
  physical console on first boot.
- Disable password auth entirely and require SSH key provisioning as part of first-boot
  setup (preferred for a template).
- At minimum, document prominently: "Change the default password before connecting to any
  network."

---

### Finding 3 — Bridge container images tag-pinned, not digest-pinned

**Severity:** Medium

**What the problem is:**
`services/catalog.yaml` pins bridge images to tags, not digests:

```yaml
whatsapp:
  image: dock.mau.dev/mautrix/whatsapp:v26.02
telegram:
  image: dock.mau.dev/mautrix/telegram:v0.15.3
signal:
  image: dock.mau.dev/mautrix/signal:v26.02.2
```

The supply chain policy (`docs/supply-chain.md`) already requires digest pinning for remote
images. The catalog does not comply.

Bridge containers are high-value targets: they run inside the NetBird mesh, hold Matrix
bridge credentials, and can read and post to Matrix rooms where Pi participates. A
compromised bridge image is already inside the security perimeter.

**Blast radius:**
A tag mutation on `dock.mau.dev` delivers a compromised bridge on the next `podman pull`.
The compromised bridge can send crafted Matrix messages to Pi's rooms, enabling prompt
injection from inside the mesh.

**Proposed remediation:**
- Pin all three bridge images to digests in `services/catalog.yaml`.
- Add a CI or `just` lint step that rejects `latest` or undigested remote image refs in the
  catalog (extending the existing `validatePinnedImage()` logic from `service_scaffold` to
  cover the catalog itself).

---

### Finding 4 — Pi-writable `~/Bloom/` enables persistent foothold

**Severity:** Medium

**What the problem is:**
Several subdirectories of `~/Bloom/` are Pi-writable by design (Pi creates agents, skills,
objects, episodes). However, three of these have outsized security impact:

- `~/Bloom/Agents/` — loaded by the daemon on every restart. Writing a new `AGENTS.md`
  here creates a persistent agent with arbitrary instructions and proactive jobs.
- `~/Bloom/guardrails.yaml` — the user-override path, loaded first. An empty or permissive
  file here disables all shell command blocks.
- `~/Bloom/Objects/` and `~/Bloom/Personas/` — injected into Pi's context at every session
  start via `before_agent_start`. Writing here achieves persistent system-prompt injection.

This is not a standalone attack. It requires a prior foothold (compromised mesh peer sending
a successful prompt injection, or a compromised container). But once achieved, it provides
persistence that survives daemon restarts, NixOS rebuilds (since `~/Bloom/` is user state,
not OS state), and compaction.

**Proposed remediation:**
- Document `~/Bloom/Agents/` and `~/Bloom/guardrails.yaml` as high-sensitivity paths in
  AGENTS.md and the setup guide.
- Pi's persona/skill should include explicit guidance: writes to `Agents/` and
  `guardrails.yaml` are high-sensitivity and should be surfaced to the user before
  executing, not done silently.
- Consider making `guardrails.yaml` read-only to the Pi process (set permissions, or store
  it outside `~/Bloom/`).

---

### Finding 5 — `autojoin: true` default creates silent command surfaces

**Severity:** Low-Medium

**What the problem is:**
`AgentDefinition.matrix.autojoin` defaults to `true` in `agent-registry.ts`. The daemon
accepts any Matrix room invite without user confirmation. Inside the NetBird mesh this is
lower risk (invites come from trusted peers), but it means new rooms become Pi command
surfaces without the user being explicitly aware.

For a public template, new users may not realise that inviting Pi to a room grants that
room's participants command-level access to their OS tools.

**Proposed remediation:**
- Default `autojoin` to `false` in the agent registry.
- Document the `autojoin: true` opt-in clearly: "Enabling autojoin means Pi will join any
  room it is invited to. All participants in that room can interact with Pi and its OS
  tools."
- For the default host agent synthesized from primary credentials, keep autojoin off unless
  explicitly enabled.

---

## What Was Explicitly Descoped

- General prompt injection from internet attackers: mitigated by NetBird perimeter.
- Misbehaving proactive job circuit breaker timing: low practical impact, low priority.
- In-memory routing state lost on restart: minor UX issue, not a security concern.
- Message length limits: token-waste risk only, not exploitable within the mesh.

---

## Design Principle Reinforced

The security model should stay simple:

1. **NetBird is the perimeter.** Everything inside is trusted. Make this explicit.
2. **Fix the seams where the perimeter assumption can silently fail** (default password,
   undigested bridge images).
3. **Limit blast radius if the perimeter is ever breached** (Bloom directory sensitivity,
   autojoin default).

No secondary auth layers, no complex ACLs. Just make the perimeter solid and document it
clearly.
