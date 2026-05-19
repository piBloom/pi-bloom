# Phase 5 — Tailnet subnet routing

Date: 2026-05-19

## Goal

Make the private Proxmox service network reachable from enrolled operator devices over Headscale/Tailscale, without exposing private services directly to the public internet.

This phase is the bridge between private access setup and the next service phase, Forgejo. After this phase, operator devices can reach `10.10.10.0/24` privately through the tailnet.

## Current status

Implemented on 2026-05-19:

```text
Subnet router: VM 100 edge
Edge private IP: 10.10.10.10/24
Edge tailnet IP: 100.64.0.2
Advertised route: 10.10.10.0/24
Headscale route status: approved and serving primary
Operator laptop: alex-laptop, 100.64.0.1
Laptop route acceptance: enabled
Tailnet-only Proxmox DNS: proxmox.nazar.studio -> 10.10.10.1
```

Verified from `alex-laptop`:

```text
10.10.10.11 dev tailscale0 table 52 src 100.64.0.1
```

Headscale private health endpoint is reachable over the subnet route:

```bash
curl -fsS http://10.10.10.11:8080/health
```

Result:

```json
{"status":"pass"}
```

Direct private SSH also works over the tailnet route:

```bash
ssh -i /home/alex/.ssh/proxmox_alex_ed25519 \
  -o IdentitiesOnly=yes \
  alex@10.10.10.11 \
  'hostname; systemctl is-active headscale'
```

Result:

```text
headscale
active
```

## Architecture

```text
alex-laptop
  100.64.0.1
  accepts routes from Headscale
  |
  | tailnet route 10.10.10.0/24
  v
edge VM 100
  tailnet: 100.64.0.2
  private: 10.10.10.10/24
  advertises 10.10.10.0/24
  forwards packets between tailscale0 and ens18
  |
  v
Proxmox private service network vmbr1
  10.10.10.0/24
  ├── 10.10.10.1  Proxmox host gateway/UI (proxmox.nazar.studio over tailnet)
  ├── 10.10.10.10 edge / Caddy
  └── 10.10.10.11 headscale
```

Public exposure remains unchanged:

```text
22/tcp   Proxmox SSH
80/tcp   edge Caddy via Proxmox DNAT
443/tcp  edge Caddy via Proxmox DNAT
```

The subnet route does **not** publish `10.10.10.0/24` to the public internet. It is only reachable by enrolled tailnet clients that accept routes.

## NixOS configuration

Source of truth:

```text
infra/hosts/edge/configuration.nix
```

Relevant settings:

```nix
networking.hosts."10.10.10.10" = [ "headscale.nazar.studio" ];

boot.kernel.sysctl = {
  "net.ipv4.ip_forward" = 1;
  "net.ipv6.conf.all.forwarding" = 1;
};

networking.firewall = {
  enable = true;
  checkReversePath = "loose";
  trustedInterfaces = [ "tailscale0" ];
  allowedTCPPorts = [ 22 80 443 ];
};

services.tailscale = {
  enable = true;
  useRoutingFeatures = "server";
};
```

The `/etc/hosts` override on `edge` is intentional. From inside `vmbr1`, resolving `headscale.nazar.studio` to the public IP `167.235.12.22` causes a hairpin path that fails with `connection refused`. Mapping it to `10.10.10.10` makes edge connect to its local Caddy listener with the same public hostname/SNI, preserving the valid public certificate while avoiding public-IP hairpin NAT.

## Deployment commands used

Deploy edge after changing the flake:

```bash
cd /home/alex/repos/ownloom/infra

nix flake check

NIX_SSHOPTS='-o ProxyJump=alex@167.235.12.22 -i /home/alex/.ssh/proxmox_alex_ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new' \
  nixos-rebuild switch \
  --flake .#edge \
  --target-host alex@10.10.10.10 \
  --sudo \
  --no-reexec
```

## Enrollment and route approval

Generate a short-lived, non-reusable preauth key on Headscale:

```bash
ssh -i /home/alex/.ssh/proxmox_alex_ed25519 \
  -o IdentitiesOnly=yes \
  -J alex@167.235.12.22 \
  alex@10.10.10.11 \
  'sudo headscale preauthkeys create --user 1 --expiration 30m'
```

Enroll `edge` and advertise the private service subnet:

```bash
ssh -i /home/alex/.ssh/proxmox_alex_ed25519 \
  -o IdentitiesOnly=yes \
  -J alex@167.235.12.22 \
  alex@10.10.10.10 \
  'sudo tailscale up \
    --login-server=https://headscale.nazar.studio \
    --auth-key=<fresh-preauth-key> \
    --advertise-routes=10.10.10.0/24 \
    --hostname=edge \
    --accept-dns=false'
```

Approve the route on Headscale:

```bash
ssh -i /home/alex/.ssh/proxmox_alex_ed25519 \
  -o IdentitiesOnly=yes \
  -J alex@167.235.12.22 \
  alex@10.10.10.11 \
  'sudo headscale nodes approve-routes --identifier 2 --routes 10.10.10.0/24'
```

Verify route status:

```bash
ssh -i /home/alex/.ssh/proxmox_alex_ed25519 \
  -o IdentitiesOnly=yes \
  -J alex@167.235.12.22 \
  alex@10.10.10.11 \
  'sudo headscale nodes list-routes'
```

Expected:

```text
ID | Hostname | Approved      | Available     | Serving (Primary)
2  | edge     | 10.10.10.0/24 | 10.10.10.0/24 | 10.10.10.0/24
```

After successful enrollment, revoke/expire the temporary preauth key:

```bash
ssh -i /home/alex/.ssh/proxmox_alex_ed25519 \
  -o IdentitiesOnly=yes \
  -J alex@167.235.12.22 \
  alex@10.10.10.11 \
  'sudo headscale preauthkeys expire --force --user 1 <preauth-key>'
```

## Client-side route acceptance

On each operator device that should reach private service IPs, enable route acceptance:

```bash
sudo tailscale set --accept-routes=true
```

Verify from the client:

```bash
tailscale status
ip route get 10.10.10.11
curl -fsS http://10.10.10.11:8080/health
```

Expected route:

```text
10.10.10.11 dev tailscale0 table 52 src 100.64.0.1
```

## Tailnet-only Proxmox DNS

Headscale advertises `proxmox.nazar.studio` as a tailnet DNS record pointing to the Proxmox private bridge IP:

```text
proxmox.nazar.studio -> 10.10.10.1
```

This is intended for tailnet clients only. It is not a public Gandi DNS record and does not expose the Proxmox UI publicly. With route acceptance enabled, access the UI from the laptop at:

```text
https://proxmox.nazar.studio:8006/
```

The Proxmox UI currently uses its normal Proxmox certificate, so browsers may show a certificate warning unless a proper certificate is configured later.

## Operations

### Check subnet router state

```bash
ssh -i /home/alex/.ssh/proxmox_alex_ed25519 \
  -o IdentitiesOnly=yes \
  alex@10.10.10.10 \
  'hostname; systemctl is-active tailscaled; tailscale status; tailscale ip -4; sysctl net.ipv4.ip_forward'
```

Expected summary:

```text
edge
active
100.64.0.2
tailscale peer list includes alex-laptop
net.ipv4.ip_forward = 1
```

### Check Headscale node and route state

```bash
ssh -i /home/alex/.ssh/proxmox_alex_ed25519 \
  -o IdentitiesOnly=yes \
  alex@10.10.10.11 \
  'sudo headscale nodes list; sudo headscale nodes list-routes'
```

### Troubleshooting

If edge enrollment hangs or fails with:

```text
dial tcp 167.235.12.22:443: connect: connection refused
```

then `edge` is trying to reach `headscale.nazar.studio` via the public IP from inside `vmbr1`. Confirm the host override exists:

```bash
ssh alex@10.10.10.10 'getent hosts headscale.nazar.studio'
```

Expected:

```text
10.10.10.10 headscale.nazar.studio
```

Then verify Caddy can proxy to Headscale locally:

```bash
ssh alex@10.10.10.10 'curl -fsS https://headscale.nazar.studio/health'
```

If the laptop cannot reach `10.10.10.11`, check whether it is accepting routes:

```bash
tailscale status
```

If it reports route advertisements but `--accept-routes` is false, run:

```bash
sudo tailscale set --accept-routes=true
```

## Rollback

Remove the approved route:

```bash
ssh alex@10.10.10.11 \
  'sudo headscale nodes approve-routes --identifier 2 --routes ""'
```

Disable Tailscale on edge by removing this block from `infra/hosts/edge/configuration.nix` and redeploying:

```nix
services.tailscale = {
  enable = true;
  useRoutingFeatures = "server";
};
```

Optionally expire the edge node:

```bash
ssh alex@10.10.10.11 'sudo headscale nodes expire --identifier 2'
```

## Next phase

With private subnet routing working, the next service can be introduced privately first. The planned next service is Forgejo on the private service network, exposed either:

1. privately over the tailnet first, and then
2. publicly through edge Caddy only for selected HTTP(S) endpoints if needed.
