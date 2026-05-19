# Phase 4 Research — Private access layer

Date: 2026-05-19

## Question

Choose the private access layer for Nazar infrastructure after the public edge became available at `https://nazar.studio/`.

The default plan has been Headscale, but this phase explicitly compares it with other self-hosted/minimal alternatives before implementation.

## Current infrastructure constraints

Current state:

```text
Public IP: 167.235.12.22
Domain: nazar.studio
Proxmox host: proxmox
Private service bridge: vmbr1 = 10.10.10.1/24
Edge VM: 100, 10.10.10.10, NixOS + Caddy
Trusted public HTTPS: https://nazar.studio/
```

Design rules already established:

- Keep Proxmox boring: virtualization, networking, storage, backups, firewall/NAT only.
- Keep public exposure minimal: `22/tcp`, `80/tcp`, `443/tcp`; optional later Git SSH on a deliberate port.
- Put service configuration in Git/NixOS where practical.
- Keep management surfaces private: Proxmox UI, admin dashboards, metrics, databases.
- Prefer simple, inspectable systems over product suites unless the extra complexity buys something concrete.

## What the private access layer must provide

Required:

1. Private access from the operator laptop to internal services.
2. Access to Proxmox UI without exposing `8006/tcp` publicly.
3. Private reachability for future VMs such as Git/Forgejo and monitoring.
4. Works well with Linux servers and at least one laptop/client.
5. Can be documented, backed up, and rebuilt.
6. Does not require handing core infrastructure control to a third-party SaaS.

Nice to have:

- Mobile clients.
- DNS names for private nodes/services.
- ACLs/policies.
- Easy client onboarding.
- Subnet routing so one enrolled node can expose `10.10.10.0/24` privately.
- Low state footprint.

Anti-goals:

- Public Proxmox UI.
- Large identity/product suite before we need it.
- Docker-compose sprawl unless clearly justified.
- A system that hides critical state outside Git/runbooks.

## Candidates researched

Snapshot from GitHub/Nixpkgs checks on 2026-05-19.

| Candidate | Type | GitHub state checked | Nixpkgs package checked | Notes |
|---|---|---:|---:|---|
| Headscale | Self-hosted Tailscale control server | `juanfont/headscale`, ~38.5k stars, latest `v0.28.0` | `headscale 0.28.0` | Best fit for current plan. |
| NetBird | WireGuard mesh + management platform | `netbirdio/netbird`, ~25.3k stars | `netbird 0.70.4` | Powerful but heavier; multiple services for self-host. |
| Netmaker | WireGuard automation/mesh platform | `gravitl/netmaker`, ~11.6k stars, latest `v1.5.1` | `netmaker 1.1.0` | More platform-like; useful for complex networks. |
| Nebula | Certificate-based overlay network | `slackhq/nebula`, ~17.3k stars | `nebula 1.10.3` | Very suckless/minimal, but less Tailscale-like UX. |
| innernet | WireGuard coordination server | `tonarino/innernet`, ~5.5k stars, latest `v1.7.1` | `innernet 1.7.1` | Minimal WireGuard-native option; more experimental. |
| plain WireGuard / wg-easy | Hub-and-spoke VPN | `wg-easy/wg-easy`, ~25.8k stars, latest `v15.3.0` | WireGuard is native; wg-easy is packaged/container-oriented | Very simple conceptually, but not a mesh/private network product. |
| ZeroTier self-hosted controller | SDN overlay | `zerotier/ZeroTierOne`, ~16.7k stars; `ztncui`, ~1.8k stars | `zerotierone 1.16.0` | Client is mature; self-host controller story is less aligned with NixOS/simple ops. |
| OpenZiti | Zero-trust overlay/access fabric | `openziti/ziti`, ~4.2k stars, Apache-2.0 | no `ziti` package found in Nixpkgs; `zrok 2.0.1` exists | Strong zero-trust/dark-service model, but heavier and more framework-like than needed for this phase. |
| Tinc | Older mesh VPN daemon | `gsliepen/tinc`, ~2.2k stars | `tinc 1.0.36` | Stable old-school option; less modern UX. |
| Defguard | WireGuard + MFA/access platform | `DefGuard/defguard`, ~2.7k stars | not selected | Security platform, not minimal. |
| Firezone | WireGuard/zero-trust access platform | `firezone/firezone`, ~8.6k stars | not selected | More enterprise/product-oriented. |

## Option analysis

### 1. Headscale

Headscale is an open-source, self-hosted implementation of the Tailscale control server.

Observed from upstream docs:

- Goal: self-hosted open-source alternative to the Tailscale control server.
- Supports the main Tailscale base feature set.
- Supports node registration, MagicDNS, split DNS, tags, routes, subnet routers, exit nodes, ACLs/grants, Tailscale SSH, OIDC, embedded DERP, and policy features.
- Official Debian/Ubuntu packages are recommended upstream because they create the user, config, and systemd service.
- Nixpkgs contains `headscale 0.28.0`.

Pros:

- Matches the existing plan exactly.
- Lets clients use the official Tailscale client ecosystem.
- Good UX for laptops and phones compared with raw WireGuard/Nebula.
- Provides MagicDNS and subnet routing, which are useful for Proxmox/private service access.
- Single control server plus Caddy reverse proxy is operationally small.
- NixOS has a viable packaging path.
- It can be private-first while still using public HTTPS for coordination.

Cons:

- More moving parts than plain WireGuard or Nebula.
- Compatibility depends on Tailscale client behavior and Headscale keeping up.
- Some Tailscale SaaS features are not relevant or not identical.
- Requires care around DERP/STUN/NAT traversal expectations.

Fit for Nazar:

Strong. It is the best balance between minimal operations and good client UX.

Recommended role:

```text
VM 101: headscale
Private IP: 10.10.10.11
Public HTTPS: https://headscale.nazar.studio/ via edge Caddy
State: /var/lib/headscale
Policy/config: Git/NixOS where practical
```

### 2. NetBird

NetBird is a WireGuard-based overlay network with SSO, MFA, access controls, dashboard, management service, signal service, relay, and related components.

Observed from the upstream self-host docker-compose template:

- Self-hosting involves multiple services such as dashboard, signal, relay, management, identity/OIDC integration, and persistent volumes.
- The project is active and polished.

Pros:

- Good product UX.
- Built around WireGuard.
- Strong identity/access-control story.
- Self-hosting supported.

Cons:

- Heavier than we need right now.
- More services and identity plumbing than Headscale.
- Less aligned with “suckless/minimal”.
- NixOS declarative module story is likely more custom work than Headscale.

Fit for Nazar:

Good if we want a polished zero-trust access product. Too heavy for the next phase if the goal is simple private management access.

### 3. Netmaker

Netmaker automates WireGuard networks and is designed for distributed virtual networks.

Pros:

- WireGuard-native.
- Strong for complex site-to-site and multi-network topologies.
- Dashboard/product workflow.

Cons:

- More platform than needed.
- Historically Docker/server stack oriented.
- Nixpkgs version checked was older than upstream release snapshot, suggesting extra packaging caution.

Fit for Nazar:

Potentially useful later if this grows into many sites/subnets. Not the minimal next step.

### 4. Nebula

Nebula is a certificate-based encrypted overlay network from Slack, focused on performance, simplicity, and security. It uses lighthouses for discovery and certificates for identity.

Pros:

- Very “suckless” in spirit: binaries, config files, certs, lighthouses.
- No SaaS compatibility target.
- No big web UI or identity stack required.
- Good for servers and technical operators.
- Nixpkgs package exists.
- Clean mental model: CA, node certs, firewall rules, lighthouse.

Cons:

- Client UX is worse than Tailscale/Headscale for casual devices.
- Mobile support exists, but not as seamless as Tailscale clients.
- You manage CA/certs/enrollment yourself.
- DNS/MagicDNS-style experience is more DIY.
- Subnet/service discovery and access policies require more manual design.

Fit for Nazar:

Best minimalist alternative if we reject Headscale. Great for a server-only/admin-only mesh. Less attractive if laptop/phone onboarding and private DNS matter.

### 5. innernet

innernet is a WireGuard coordination system with CIDR-based network organization and ACL-ish primitives.

Pros:

- WireGuard underneath.
- Minimal compared with NetBird/Netmaker.
- Nice conceptual model around CIDRs.
- Nixpkgs package exists.

Cons:

- Upstream README notes no independent security audit and describes it as experimental at its stage.
- Smaller ecosystem than Headscale/Nebula.
- More manual than Headscale for clients and DNS.

Fit for Nazar:

Interesting, but not ideal as the main private access layer for infrastructure we want to rely on.

### 6. Plain WireGuard / wg-easy

Plain WireGuard can be configured directly. wg-easy adds a web UI and QR-code onboarding.

Pros:

- Minimal protocol and excellent kernel support.
- Easy to reason about in hub-and-spoke mode.
- Very low infrastructure requirements.
- No control-plane compatibility issue.

Cons:

- Not a mesh by default.
- Peer management becomes manual as devices grow.
- No MagicDNS/subnet-router UX out of the box.
- wg-easy adds a web UI/container state surface that we then need to secure and back up.
- Roaming/NAT traversal is less automatic than Tailscale-style systems.

Fit for Nazar:

Good fallback if we only need “laptop VPN into server”. Not as good if future services/VMs should join a private network cleanly.

### 7. ZeroTier with self-hosted controller

ZeroTier is mature and easy for clients, but self-hosting the network controller is less aligned with the simple NixOS/Proxmox plan.

Pros:

- Mature clients and SDN model.
- Works well for many users in practice.

Cons:

- Self-host controller plus UI is less straightforward than Headscale.
- More opaque SDN model than WireGuard/Nebula.
- Less aligned with “Git/NixOS as source of truth”.

Fit for Nazar:

Reasonable technology, but not the preferred self-hosted path here.

### 8. OpenZiti

OpenZiti is an open-source zero-trust networking platform sponsored by NetFoundry. It provides a controller, routers, tunnelers, SDKs, identity-based policy, and end-to-end encrypted overlay connectivity. Its strongest idea is making services “dark”: unauthorized clients cannot even see listening ports, and applications can eventually embed OpenZiti SDKs directly.

Pros:

- Excellent security model for service-level private access: authenticate and authorize before connect.
- Strong “dark service” posture: internal apps do not need public inbound ports.
- More granular than a VPN/tailnet: access can be per service rather than “join network, then route IPs”.
- Supports brownfield access via tunnelers and stronger greenfield access via SDKs.
- Fully open source under Apache-2.0, with a commercial sponsor behind it.

Cons:

- It is a full zero-trust access fabric, not a small private management VPN.
- More concepts and components to operate: controller, edge routers/fabric routers, identities, services, policies, tunnelers, enrollment.
- Client/admin UX is more specialized than Tailscale/Headscale for the simple “laptop reaches Proxmox/private VMs” use case.
- No `ziti` package was found in the checked Nixpkgs snapshot, so a clean declarative NixOS deployment may require more custom packaging/service work.
- It pushes us toward service-by-service access design before the infrastructure actually needs that complexity.

Fit for Nazar:

Technically strong, especially if Nazar becomes a multi-user service platform with per-application private access, agent/workload identities, or a need to keep every internal service completely dark. For the next phase, it is too much system for the immediate requirement: one operator needs reliable private access to Proxmox and future internal VMs.

Recommended role:

Do not use OpenZiti as Phase 4’s default private access layer. Revisit it later if requirements shift from “private admin network” to “zero-trust service access platform”.

### 9. Tinc

Tinc is an older mesh VPN daemon.

Pros:

- Old, stable, Unix-y.
- Small and understandable.
- Nixpkgs package exists.

Cons:

- Older ecosystem and UX.
- Less modern client/mobile/private-DNS experience.
- Less momentum than Headscale/Nebula.

Fit for Nazar:

Useful as a fallback for old-school mesh, but not a first choice.

### 10. Defguard / Firezone

These are more complete zero-trust/access-management products.

Pros:

- Strong security/product stories.
- More enterprise-friendly workflows.

Cons:

- Too much surface area for this stage.
- Not minimal.
- More identity/state/components to own.

Fit for Nazar:

Not now. Revisit if requirements grow to many users, MFA-heavy workflows, compliance, or centralized access governance.

## Scoring for this infrastructure

Scale: 1 poor, 5 excellent.

| Option | Minimal/suckless | Client UX | Self-host clarity | NixOS fit | Private DNS/routing | Operational risk | Overall |
|---|---:|---:|---:|---:|---:|---:|---:|
| Headscale | 4 | 5 | 4 | 4 | 5 | 4 | 4.5 |
| Nebula | 5 | 3 | 5 | 4 | 3 | 4 | 4.0 |
| Plain WireGuard | 5 | 3 | 5 | 5 | 2 | 4 | 3.8 |
| innernet | 4 | 3 | 4 | 4 | 3 | 3 | 3.5 |
| NetBird | 2 | 5 | 3 | 3 | 5 | 3 | 3.5 |
| OpenZiti | 2 | 3 | 3 | 2 | 5 | 3 | 3.3 |
| Netmaker | 2 | 4 | 3 | 3 | 4 | 3 | 3.2 |
| ZeroTier self-host | 3 | 4 | 3 | 3 | 4 | 3 | 3.2 |
| Tinc | 4 | 2 | 4 | 4 | 2 | 4 | 3.2 |
| Defguard/Firezone | 1 | 4 | 2 | 2 | 4 | 3 | 2.7 |

## Recommendation

Use **Headscale** as the main option.

Reasoning:

- It satisfies the existing plan and gives the best practical UX for laptop/client enrollment.
- It is still small enough for a single-purpose NixOS VM.
- It provides the features we are likely to need next: MagicDNS, subnet routing, ACLs/policy, and easy client onboarding.
- It avoids the heavier product-stack complexity of NetBird/Netmaker/Defguard/Firezone.
- It avoids adopting a full zero-trust access fabric such as OpenZiti before we need service-by-service identity and dark-service policy.
- It is less bare-metal minimal than Nebula/plain WireGuard, but the UX improvement is worth it for this infrastructure.

Keep **Nebula** as the “suckless fallback” if Headscale feels too product-like during implementation. Nebula is the cleanest minimal alternative: certs, config files, lighthouses, no web platform. The tradeoff is more manual onboarding and weaker consumer-client UX.

Avoid NetBird/Netmaker for now. They are good projects, but they solve a larger problem than we currently have.

Avoid OpenZiti for Phase 4 for the same reason: it is a strong platform, but it solves a service-access/security-architecture problem that is larger than the current private-admin-network requirement.

## Proposed Phase 4 architecture

```text
Public internet
  |
  | 443
  v
edge VM 100, 10.10.10.10, Caddy
  |
  | reverse_proxy https://headscale.nazar.studio -> 10.10.10.11:8080
  v
headscale VM 101, 10.10.10.11, NixOS + Headscale
  |
  +-- tailnet clients:
      - operator laptop
      - optionally Proxmox host
      - future Git VM
      - future monitoring VM
```

Public exposure remains only:

```text
22/tcp   Proxmox SSH
80/tcp   Caddy HTTP redirect / ACME
443/tcp  Caddy HTTPS
```

Headscale service port `8080` stays private on `vmbr1`; only Caddy exposes `https://headscale.nazar.studio`.

## Proposed DNS

Add:

```text
A  headscale  167.235.12.22
```

Optional later:

```text
A  git        167.235.12.22
A  status     167.235.12.22
```

## Proposed VM allocation

```text
VM ID: 101
Name: headscale
IP: 10.10.10.11/24
Gateway: 10.10.10.1
CPU: 1 vCPU
RAM: 512 MiB to 1 GiB
Disk: 8 to 16 GiB
OS: NixOS
State: /var/lib/headscale
```

## Proposed implementation steps

1. Create `infra/hosts/headscale/configuration.nix`.
2. Add `headscale` to `infra/flake.nix` NixOS configurations and image package/checks.
3. Build/import VM 101 using the established NixOS-on-Proxmox pattern.
4. Configure Headscale minimally:
   - server URL: `https://headscale.nazar.studio`
   - listen address: `0.0.0.0:8080` or private interface binding if supported cleanly
   - metrics/admin surfaces not publicly proxied
   - SQLite state initially, because the deployment is small
5. Add Caddy reverse proxy on `edge`:
   - `headscale.nazar.studio -> 10.10.10.11:8080`
6. Deploy edge and headscale.
7. Verify:
   - DNS resolves.
   - `https://headscale.nazar.studio/` reaches Headscale.
   - Headscale service is active.
   - first preauth key works.
   - laptop joins tailnet.
   - laptop can reach `10.10.10.1`/Proxmox private path if subnet routing is configured.
8. Document enrollment, backup, recovery, and rollback.

## Open design decisions before implementation

1. Hostname: use `headscale.nazar.studio`? Recommended: yes.
2. Tailnet name/base domain: e.g. `nazar.ts.net` is not appropriate because that is Tailscale-owned style; use something like `tailnet.nazar.studio` internally if needed.
3. Enroll Proxmox host directly, or use a subnet router VM?
   - Safer minimal first step: enroll only laptop and Headscale VM; then add subnet routing deliberately.
   - More useful first step: configure Headscale/edge or a tiny router VM as subnet router for `10.10.10.0/24`.
4. OIDC now or later?
   - Recommended: later. Start with CLI/preauth keys for minimal bootstrapping.
5. SQLite or PostgreSQL?
   - Recommended: SQLite initially. Back up `/var/lib/headscale`; move to PostgreSQL only if requirements grow.

## Final decision for next phase

Proceed with **Headscale on VM 101** as the default implementation path, while documenting Nebula as the minimal fallback.
