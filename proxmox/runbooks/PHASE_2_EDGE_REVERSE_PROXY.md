# Phase 2 Plan — Edge Reverse Proxy

Date: 2026-05-19

## Goal

Turn the existing `edge` NixOS VM into the public HTTP/HTTPS entrypoint for Nazar services.

Phase 2 should expose only ports `80/tcp` and `443/tcp` publicly, forward those ports from Proxmox to the private `edge` VM, and run Caddy on `edge` as the reverse proxy.

## Starting state

Phase 1 is complete:

```text
Proxmox public IP: 167.235.12.22
Public bridge: vmbr0
Private bridge: vmbr1 = 10.10.10.1/24
Edge VM: 100
Edge private IP: 10.10.10.10/24
Edge default gateway: 10.10.10.1
Edge SSH: available through ProxyJump proxmox
Edge NixOS flake: /home/alex/repos/ownloom/infra#edge
```

## Target architecture

```text
Public internet
  |
  | 80/tcp, 443/tcp
  v
Proxmox host 167.235.12.22
  |
  | nft DNAT
  v
edge VM 10.10.10.10
  |
  | Caddy
  v
future private service VMs
```

At the end of Phase 2:

```text
Public 80/tcp  -> Proxmox DNAT -> 10.10.10.10:80  -> Caddy
Public 443/tcp -> Proxmox DNAT -> 10.10.10.10:443 -> Caddy
```

## Design decisions

### Reverse proxy

Use Caddy.

Reasons:

- simple declarative NixOS module
- automatic HTTPS once real domains point at the server
- easy reverse proxy config for later Headscale/Git services
- lower operational overhead than nginx for this setup

### Public exposure

Only expose:

```text
80/tcp
443/tcp
```

Keep these private for now:

```text
Proxmox UI 8006/tcp
future Headscale admin/API internals
future Git SSH unless explicitly opened later
```

### Caddy first response

Before domain/DNS is finalized, configure a minimal default response on port 80 so forwarding can be verified by IP:

```text
Nazar edge is online
```

For HTTPS, Caddy automatic certificates require DNS names that resolve to `167.235.12.22` and inbound 80/443 reachability. If no domain is ready, verify only HTTP forwarding first and keep HTTPS/domain work as the next sub-step.

## Required questions before irreversible/public changes

Phase 2 changes are less destructive than Phase 1, but they do expose public web ports. Before opening final public service routing, confirm:

1. Which domain/subdomains should point at this host?
   - Example: `ownloom.example.com`, `headscale.example.com`, `git.example.com`
2. Are DNS records already controlled and editable?
3. Should the first public Caddy site be a plain health page, or should it immediately proxy a real service?

If no domain is available yet, proceed with IP-only HTTP health check and leave domain TLS as pending.

## Implementation tasks

### Task 1 — Add Caddy module to the infra flake

Modify:

```text
/home/alex/repos/ownloom/infra/hosts/edge/configuration.nix
```

Add Caddy and firewall ports:

```nix
services.caddy = {
  enable = true;
  virtualHosts.":80".extraConfig = ''
    respond "Nazar edge is online\n"
  '';
};

networking.firewall.allowedTCPPorts = [
  22
  80
  443
];
```

Keep SSH open on the private VM interface.

Validate locally:

```bash
cd /home/alex/repos/ownloom/infra
nix flake check --no-build
```

Deploy:

```bash
cd /home/alex/repos/ownloom/infra

NIX_SSHOPTS='-o ProxyJump=proxmox -i /home/alex/.ssh/proxmox_alex_ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new' \
  nixos-rebuild switch \
  --flake .#edge \
  --target-host alex@10.10.10.10 \
  --sudo \
  --no-reexec
```

Verify on the private network from Proxmox:

```bash
ssh proxmox-root 'curl -i --max-time 5 http://10.10.10.10/'
```

Expected:

```text
HTTP/1.1 200 OK
Nazar edge is online
```

### Task 2 — Add Proxmox DNAT for public HTTP/HTTPS

Modify Proxmox nftables config to add prerouting DNAT from public `vmbr0` to `edge`.

Expected additional rules:

```nft
table ip ownloom_nat {
  chain prerouting {
    type nat hook prerouting priority dstnat; policy accept;
    iifname "vmbr0" tcp dport { 80, 443 } dnat to 10.10.10.10
  }

  chain postrouting {
    type nat hook postrouting priority srcnat; policy accept;
    ip saddr 10.10.10.0/24 oifname "vmbr0" masquerade
  }
}
```

Apply safely:

```bash
ssh proxmox-root 'nft -c -f /etc/nftables.conf && systemctl reload nftables'
```

Verify rules:

```bash
ssh proxmox-root 'nft list table ip ownloom_nat'
```

### Task 3 — Verify public HTTP forwarding

From the local development machine:

```bash
curl -i --max-time 10 http://167.235.12.22/
```

Expected:

```text
HTTP/1.1 200 OK
Nazar edge is online
```

Also verify Proxmox still responds to SSH and the guest still has outbound internet:

```bash
ssh proxmox 'hostname'
ssh edge 'curl -I --max-time 10 https://cache.nixos.org/ | sed -n "1p"'
```

### Task 4 — Add DNS/TLS when domain is known

Once domain names are selected and DNS A/AAAA records point at `167.235.12.22`, update Caddy virtual hosts.

Example:

```nix
services.caddy.virtualHosts."nazar.studio".extraConfig = ''
  respond "Nazar edge is online\n"
'';
```

Then deploy and verify:

```bash
curl -I https://nazar.studio/
```

Expected:

```text
HTTP/2 200
```

### Task 5 — Document Phase 2 execution notes

Update:

```text
/home/alex/repos/ownloom/proxmox/runbooks/NIXOS_GUEST_PHASES.md
/home/alex/repos/ownloom/proxmox/runbooks/PHASE_2_EDGE_REVERSE_PROXY.md
```

Include:

- Caddy config added
- exact nftables DNAT rules
- verification output
- domains configured, if any
- recovery/rollback commands

## Rollback plan

### Disable public DNAT

Remove or comment the `prerouting` chain/rules from `/etc/nftables.conf`, then:

```bash
ssh proxmox-root 'nft -c -f /etc/nftables.conf && systemctl reload nftables'
```

### Disable Caddy on edge

Revert the Caddy changes in:

```text
/home/alex/repos/ownloom/infra/hosts/edge/configuration.nix
```

Then redeploy:

```bash
cd /home/alex/repos/ownloom/infra

NIX_SSHOPTS='-o ProxyJump=proxmox -i /home/alex/.ssh/proxmox_alex_ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new' \
  nixos-rebuild switch \
  --flake .#edge \
  --target-host alex@10.10.10.10 \
  --sudo \
  --no-reexec
```

## Verification checklist

Before marking Phase 2 complete:

- [ ] `nix flake check --no-build` passes.
- [ ] `nixos-rebuild switch --target-host alex@10.10.10.10` succeeds.
- [ ] `systemctl is-active caddy` on `edge` returns `active`.
- [ ] `curl http://10.10.10.10/` from Proxmox returns the expected health page.
- [ ] `nft list table ip ownloom_nat` shows DNAT for `80` and `443`.
- [ ] `curl http://167.235.12.22/` from outside returns the expected health page.
- [ ] SSH to Proxmox still works.
- [ ] SSH to `edge` through Proxmox still works.
- [ ] Guest outbound internet still works.
- [ ] Phase 2 execution notes are appended to this runbook.

## Do not proceed to later phases until

- public HTTP forwarding is verified,
- rollback is documented,
- DNS/domain decision is recorded,
- and the repo has a clean checkpoint for Phase 1 + Phase 2 baseline.

---

# Phase 2 Execution Notes — 2026-05-19

## Status

Base Phase 2 is implemented for public HTTP.

Current state:

- Caddy is installed and active on `edge`.
- `edge` firewall allows `22/tcp`, `80/tcp`, and `443/tcp`.
- Proxmox DNAT forwards public `80/tcp` and `443/tcp` from `vmbr0` to `10.10.10.10`.
- Public HTTP to `http://167.235.12.22/` returns the Caddy health page.
- Public HTTPS is not considered complete until a real DNS name is selected and pointed at `167.235.12.22`.

## NixOS edge changes

Modified:

```text
/home/alex/repos/ownloom/infra/hosts/edge/configuration.nix
```

Added:

```nix
networking.firewall = {
  enable = true;
  allowedTCPPorts = [
    22
    80
    443
  ];
};

services.caddy = {
  enable = true;
  virtualHosts.":80".extraConfig = ''
    respond "Nazar edge is online\n"
  '';
  virtualHosts.":443".extraConfig = ''
    tls internal
    respond "Nazar edge is online\n"
  '';
};
```

Note: the `:443` health endpoint is only a placeholder. Real public HTTPS should use a DNS name and a named Caddy virtual host so Caddy can obtain a valid public certificate.

## Deployment command used

```bash
cd /home/alex/repos/ownloom/infra

NIX_SSHOPTS='-o ProxyJump=proxmox -i /home/alex/.ssh/proxmox_alex_ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new' \
  nixos-rebuild switch \
  --flake .#edge \
  --target-host alex@10.10.10.10 \
  --sudo \
  --no-reexec
```

New current system after deploy:

```text
/nix/store/2k99vdzjn8kdp4kzsxgbwmmkmgqki1mj-nixos-system-edge-25.11.20260514.d7a713c
```

## Proxmox DNAT changes

Modified:

```text
/etc/nftables.conf
```

A backup was created before editing:

```text
/etc/nftables.conf.pre-phase2-<timestamp>
```

Active table after Phase 2:

```nft
table ip ownloom_nat {
  chain prerouting {
    type nat hook prerouting priority dstnat; policy accept;
    iifname "vmbr0" tcp dport { 80, 443 } dnat to 10.10.10.10
  }

  chain postrouting {
    type nat hook postrouting priority srcnat; policy accept;
    ip saddr 10.10.10.0/24 oifname "vmbr0" masquerade
  }
}
```

Validation/apply command used:

```bash
nft -c -f /etc/nftables.conf
systemctl reload nftables
```

## Verification results

### Local flake validation

```bash
cd /home/alex/repos/ownloom/infra
nix flake check --no-build
```

Result:

```text
all checks passed!
```

### Private Caddy check from Proxmox

```bash
curl -i --max-time 5 http://10.10.10.10/
```

Result:

```text
HTTP/1.1 200 OK
Server: Caddy
Nazar edge is online\n
```

### Public HTTP check

```bash
curl -i --max-time 10 http://167.235.12.22/
```

Result:

```text
HTTP/1.1 200 OK
Server: Caddy
Nazar edge is online\n
```

### Guest health check

Verified:

```text
caddy: active
sshd: active
qemu-guest-agent: active
cache.nixos.org: HTTP/2 200
```

### Proxmox health check

Verified:

```text
VM 100 status: running
QEMU guest agent ping: success
nft DNAT for 80/443: present
NAT masquerade: present
```

## HTTPS/DNS remaining work

Current public HTTPS probe by raw IP is not a success criterion:

```bash
curl -k -i --max-time 8 https://167.235.12.22/
```

Observed:

```text
curl: (35) TLS connect error: tlsv1 alert internal error
```

This is expected to remain unresolved until a real domain/subdomain is selected and DNS points to `167.235.12.22`.

To complete HTTPS:

1. Choose the public domain/subdomain for the edge health page and future services.
2. Add DNS `A` records pointing at `167.235.12.22`.
3. Replace the placeholder `:443` block with named Caddy virtual hosts.
4. Redeploy `infra#edge`.
5. Verify `curl -I https://<domain>/` returns `HTTP/2 200` with a trusted certificate.

## Rollback after implemented changes

### Roll back public forwarding only

On Proxmox, remove the `prerouting` chain from `/etc/nftables.conf`, validate, and reload:

```bash
nft -c -f /etc/nftables.conf
systemctl reload nftables
```

Alternatively restore the pre-Phase-2 backup:

```bash
cp /etc/nftables.conf.pre-phase2-<timestamp> /etc/nftables.conf
nft -c -f /etc/nftables.conf
systemctl reload nftables
```

### Roll back Caddy on `edge`

Remove the `services.caddy` block and remove `80`/`443` from `networking.firewall.allowedTCPPorts`, then redeploy:

```bash
cd /home/alex/repos/ownloom/infra

NIX_SSHOPTS='-o ProxyJump=proxmox -i /home/alex/.ssh/proxmox_alex_ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new' \
  nixos-rebuild switch \
  --flake .#edge \
  --target-host alex@10.10.10.10 \
  --sudo \
  --no-reexec
```

## Phase 2 completion state

Completed:

- [x] Caddy installed on `edge`.
- [x] Local flake check passes.
- [x] Declarative deploy to `edge` succeeds.
- [x] Caddy responds on private HTTP.
- [x] Proxmox DNAT forwards public `80/tcp` and `443/tcp` to `edge`.
- [x] Public HTTP health page works.
- [x] SSH to Proxmox still works.
- [x] SSH to `edge` through Proxmox still works.
- [x] Guest outbound internet still works.
- [x] Rollback documented.

Pending domain/TLS finalization:

- [ ] Choose production domain/subdomains.
- [ ] Add DNS records.
- [ ] Replace placeholder TLS config with named Caddy virtual hosts.
- [ ] Verify trusted HTTPS certificate.
