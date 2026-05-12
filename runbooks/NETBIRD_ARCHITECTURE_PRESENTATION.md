---
marp: true
title: OwnLoom / Nazar NetBird Architecture
paginate: true
---

# OwnLoom / Nazar NetBird Architecture

Current private-access model, recent changes, and next hardening steps.

Date: 2026-05-11

---

# Executive summary

- `nazar` is the **single canonical remote shell entrypoint**.
- `https://nazar.studio/` is now the private NetBird dashboard.
- `https://nazar.studio/zellij/` provides browser Zellij access with Zellij token auth.
- Root SSH on `nazar` opens a plain shell by default; persistent **Zellij** session `nazar` is still available manually.
- VM shell access goes from `nazar` to VM private NAT aliases.
- NetBird policies are now least-privilege: no all-to-all, no admin-to-VM SSH.
- NetBird DNS Custom Zone `nazar.studio` now owns private service names.
- Public exposure remains opt-in only; Minecraft has an optional public-forward toggle but is currently NetBird-private.

---

# Canonical admin flow

```text
Admin device
  -> NetBird private DNS / NetBird SSH
  -> https://nazar.studio/ dashboard or shell on nazar
  -> optional browser/manual Zellij session `nazar`
  -> SSH over vmbr1 private NAT aliases
  -> VMs
```

Commands:

```bash
netbird ssh root@nazar
ssh alex@ownloom
ssh alex@ownloom-data
ssh alex@git
ssh alex@minecraft
```

`alex` is the canonical NixOS VM admin user. VM passwords remain locked and normal access is key-only through `nazar`; root VM SSH remains key-only for break-glass and current compatibility.

---

# Why this model

- One external shell target to secure and audit: `nazar`.
- VMs do not need direct admin SSH from every admin device.
- VM access stays simple: normal OpenSSH over the private bridge.
- NetBird remains the control plane for identity, private service access, and DNS.
- Break-glass remains outside NetBird: Hetzner Rescue.

---

# Network topology

```text
Internet
  |
  | public admin SSH/UI blocked
  |
NetBird Cloud control plane
  |
Admin peers ───────────────┐
                           |
                           v
                      nazar / Proxmox
                      100.124.51.27
                      vmbr1: 10.10.10.1/24
                           |
       ┌───────────────────┼───────────────────┐
       v                   v                   v
 git VM 101         ownloom VM 120      ownloom-data VM 121
 10.10.10.21        10.10.10.40         10.10.10.41
```

---

# VM inventory

| VM | Role | NAT IP | NetBird IP | Status |
|---|---|---:|---:|---|
| 101 `git` | Forgejo Git | `10.10.10.21` | `100.124.135.247` | active |
| 110 `minecraft` | PaperMC | `10.10.10.30` | via `nazar`/`mc.nazar.studio` | NetBird-private; public toggle disabled |
| 120 `ownloom` | Pi agent + technical wiki | `10.10.10.40` | `100.124.202.128` | active |
| 121 `ownloom-data` | DAV personal data | `10.10.10.41` | `100.124.7.246` | active |
| 122 `ownloom-vault` | future vault | `10.10.10.42` | reserved | not deployed |

---

# Private host aliases on `nazar`

`/etc/hosts` on `nazar` maps VM names to private NAT IPs:

```text
10.10.10.21  git
10.10.10.30  minecraft
10.10.10.40  ownloom
10.10.10.41  ownloom-data
10.10.10.42  ownloom-vault
```

This is why the post-login workflow is short and memorable:

```bash
ssh alex@ownloom-data
```

---

# NetBird peer groups

```text
admins
  - EVO-X1
  - yoga

proxmox-hosts
  - nazar

vms
  - git
  - ownloom
  - ownloom-data

ownloom-core
  - ownloom

ownloom-data-services
  - ownloom-data
```

`vms` is descriptive. Service policy uses narrower groups where possible.

---

# NetBird access policies

| Policy | Source | Destination | Protocol/ports | Purpose |
|---|---|---|---|---|
| `admins-to-proxmox-services` | `admins` | `proxmox-hosts` | TCP `80,443,8006,10022` | private web, Proxmox UI, Git SSH proxy |
| `admins-to-nazar-netbird-ssh` | `admins` | `proxmox-hosts` | NetBird SSH | canonical shell |
| `admins-to-ownloom-data-dav` | `admins` | `ownloom-data-services` | TCP `80` | DAV access |
| `ownloom-to-ownloom-data-dav` | `ownloom-core` | `ownloom-data-services` | TCP `80` | OwnLoom wiki/data backend |

No normal policy allows admin peers to SSH directly into VMs.

---

# What is intentionally not allowed

- No public SSH to `nazar`.
- No public Proxmox UI.
- No default all-to-all NetBird policy.
- No `admins -> vms` TCP/22 policy.
- No NetBird SSH on VMs.
- No public OwnLoom services.
- No public DAV.

Minecraft remains the explicit public-service exception only when its public forwarding toggle is intentionally enabled; current forwarding is NetBird-private.

---

# NetBird SSH posture

Canonical:

```text
admins -> nazar : NetBird SSH
```

Not canonical:

```text
admins -> VMs : NetBird SSH
admins -> VMs : TCP/22 over NetBird
```

Current next hardening item:

```text
Configure NetBird SSH Limited Access mapping:
admin user/group -> local root on nazar only
```

---

# NetBird private DNS

Custom Zone:

```text
nazar.studio
```

Records:

```text
nazar.studio          -> 100.124.51.27
pve.nazar.studio      -> 100.124.51.27
git.nazar.studio      -> 100.124.51.27
ownloom.nazar.studio  -> 100.124.202.128
data.nazar.studio     -> 100.124.7.246
mc.nazar.studio       -> 100.124.51.27
```

---

# Domain strategy

Two layers:

1. **Public DNS / Reverse Proxy layer**
   - useful for browser-trusted certs and stable human URLs when a service is explicitly made public
   - default for `*.nazar.studio` remains disabled/private unless a service is hardened and intentionally exposed

2. **NetBird Custom Zone**
   - infrastructure/service naming controlled by NetBird
   - examples: `nazar.studio`, `pve.nazar.studio`, `data.nazar.studio`

Goal: keep services private and infrastructure-provider agnostic.

---

# OwnLoom split architecture

```text
ownloom VM 120
  - Pi agent runtime
  - technical/local wiki
  - OwnLoom packages/extensions
  - no public HTTP
  - no personal DAV storage

ownloom-data VM 121
  - Radicale CalDAV/CardDAV
  - nginx WebDAV at /files/
  - personal wiki/files/journal data
  - reachable over NetBird policy only
```

Data and agent runtime are intentionally separated.

---

# OwnLoom data flow

```text
Admin peer ───────────────┐
                          v
                 data.nazar.studio
                          |
ownloom VM 120 ───────────┘
                          v
                 ownloom-data VM 121
                 nginx WebDAV / Radicale
```

Allowed paths:

```text
admins -> ownloom-data TCP/80
ownloom -> ownloom-data TCP/80
```

Future: move this to HTTPS/TCP 443.

---

# Validation performed

- `nix flake check --no-build` passes.
- VM NetBird SSH disabled on `ownloom` and `ownloom-data`.
- `ownloom` resolves NetBird custom DNS:

```text
data.nazar.studio -> 100.124.7.246
```

- `ownloom` can reach `ownloom-data` DAV:

```text
HTTP/1.1 200 OK
DAV: 1
```

---

# Security changes made

- Removed TCP/22 from admin-to-Proxmox service policy.
- NetBird SSH is now the shell path to `nazar`.
- Added narrow DAV policies instead of broad VM policy.
- Added service-specific VM groups.
- Created NetBird DNS Custom Zone.
- Revoked the temporary NetBird API token after use.
- Updated docs to mark old public SSH tunnel docs as historical/recovery-only.

---

# Operational runbook now

Daily dashboard and shell:

```text
https://nazar.studio/          # private dashboard
https://nazar.studio/zellij/   # browser Zellij, token required
```

```bash
netbird ssh root@nazar
```

Inside `nazar` (plain shell or optional manual Zellij):

```bash
ssh alex@ownloom
ssh alex@ownloom-data
ssh alex@git
```

DAV check from allowed peer:

```bash
curl -fsS http://data.nazar.studio/
curl -fsS -X OPTIONS -i http://data.nazar.studio/files/
```

---

# Remaining decisions

1. Remove temporary browser-client NetBird SSH policy after active browser SSH session is no longer needed.
2. Decide whether `s25ultra` should join `admins`.
3. Configure NetBird SSH Limited Access mapping:
   - admin user/group -> local `root` on `nazar` only.
4. Add posture checks for admin policies if desired.
5. Move OwnLoom Data DAV from HTTP/80 to HTTPS/443.
6. Add SOPS-managed DAV credentials before real personal data.
7. Define and test backup/restore for `ownloom-data`.

---

# Proposed next step

Before changing more policy:

1. Confirm current admin devices:
   - `EVO-X1`
   - `yoga`
   - maybe `s25ultra`?
2. Confirm browser-client temporary policy can be deleted.
3. Configure NetBird SSH Limited Access for `root@nazar`.
4. Re-test:

```bash
netbird ssh root@nazar
ssh alex@ownloom
curl http://data.nazar.studio/
```

---

# Target end state

```text
Secure by default
Simple to operate
Declarative where possible
No public admin plane
NetBird controls identity, service policy, and private DNS
nazar remains the only SSH entrypoint
VMs stay private and replaceable
OwnLoom data stays separated from agent runtime
```
