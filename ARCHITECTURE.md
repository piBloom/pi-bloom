# Nazar infrastructure architecture

Date: 2026-05-19

This file is the always-current reference diagram for the active Nazar/Ownloom infrastructure. Update it in the same commit as any infrastructure change that adds, removes, renames, or re-routes hosts, services, DNS names, public ports, private networks, tailnet nodes, or deployment flows.

## Current topology

```mermaid
flowchart TB
  internet((Public internet))
  gandi["Gandi DNS\nnazar.studio zone"]
  publicIP["167.235.12.22\nHetzner dedicated server"]

  subgraph host["Proxmox VE 9 host: proxmox / nazar"]
    direction TB
    ssh["Public SSH\n22/tcp -> Proxmox host"]
    vmbr0["vmbr0\npublic bridge"]
    nft["nftables DNAT\n80/443 -> 10.10.10.10"]
    vmbr1["vmbr1 private service network\n10.10.10.1/24"]

    subgraph edge["VM 100: edge\nNixOS, 10.10.10.10\nTailnet 100.64.0.2"]
      caddy["Caddy reverse proxy\npublic HTTP/HTTPS"]
      tailscaled["Tailscale subnet router\nadvertises 10.10.10.0/24"]
      edgeHealth["nazar.studio\nNazar edge health page"]
      headscaleVhost["headscale.nazar.studio\nreverse_proxy 10.10.10.11:8080"]
    end

    subgraph hs["VM 101: headscale\nNixOS, 10.10.10.11"]
      headscale["Headscale\n0.0.0.0:8080"]
      sqlite["SQLite state\n/var/lib/headscale/db.sqlite"]
      userAlex["Headscale user: alex"]
    end
  end

  laptop["alex-laptop\nTailnet IP: 100.64.0.1\naccept-routes enabled"]
  subnetRoute["Active subnet route\n10.10.10.0/24 via edge"]
  repo["Git repo\n/home/alex/repos/ownloom"]
  infraFlake["infra/ flake\nedge + headscale NixOS configs"]
  runbooks["proxmox/runbooks/\ninstallation + phase docs"]

  gandi -->|"A nazar.studio"| publicIP
  gandi -->|"A www.nazar.studio"| publicIP
  gandi -->|"A headscale.nazar.studio"| publicIP
  internet -->|"22/tcp"| ssh
  internet -->|"80/443"| publicIP --> vmbr0 --> nft --> caddy
  caddy --> edgeHealth
  caddy --> headscaleVhost --> headscale
  headscale --> sqlite
  headscale --> userAlex
  laptop -->|"Tailscale control plane\nHTTPS headscale.nazar.studio"| caddy
  laptop -.->|"enrolled node"| userAlex
  tailscaled -->|"routes tailnet clients to"| vmbr1
  laptop -->|"private service access\n10.10.10.0/24"| subnetRoute --> tailscaled
  repo --> infraFlake
  repo --> runbooks
  infraFlake -->|"nixos-rebuild"| edge
  infraFlake -->|"nixos-rebuild / qcow deployment"| hs
```

## Active public endpoints

```mermaid
flowchart LR
  client["Browser / Tailscale client"]
  dns["Public DNS"]
  ip["167.235.12.22"]
  caddy["edge VM Caddy\n10.10.10.10"]
  site["nazar.studio\nhealth page"]
  hs["Headscale VM\n10.10.10.11:8080"]

  client --> dns
  dns -->|"nazar.studio, www.nazar.studio"| ip
  dns -->|"headscale.nazar.studio"| ip
  ip -->|"DNAT 80/443"| caddy
  caddy -->|"nazar.studio / www"| site
  caddy -->|"headscale.nazar.studio"| hs
```

## Active private subnet flow

```mermaid
flowchart LR
  laptop["alex-laptop\n100.64.0.1"]
  hsControl["Headscale control plane\nheadscale.nazar.studio"]
  edgeTs["edge subnet router\n100.64.0.2 / 10.10.10.10"]
  privateNet["vmbr1 private network\n10.10.10.0/24"]
  proxmox["Proxmox gateway\n10.10.10.1"]
  headscaleVm["headscale VM\n10.10.10.11:8080"]
  futureForgejo["planned Forgejo VM\n10.10.10.x"]

  laptop -->|"accepts 10.10.10.0/24 route"| hsControl
  edgeTs -->|"advertises 10.10.10.0/24"| hsControl
  laptop -->|"private traffic over tailscale0"| edgeTs
  edgeTs --> privateNet
  privateNet --> proxmox
  privateNet --> headscaleVm
  privateNet -.-> futureForgejo
```

## Headscale enrollment flow

```mermaid
sequenceDiagram
  participant Operator as alex-laptop
  participant Proxmox as Proxmox host 167.235.12.22
  participant HS as Headscale VM 10.10.10.11
  participant DNS as Gandi/Public DNS
  participant Edge as edge Caddy 10.10.10.10

  Operator->>Proxmox: SSH ProxyJump
  Proxmox->>HS: SSH to private VM
  Operator->>HS: Generate short-lived preauth key
  Operator->>DNS: Resolve headscale.nazar.studio
  DNS-->>Operator: 167.235.12.22
  Operator->>Edge: tailscale up --login-server=https://headscale.nazar.studio --auth-key=...
  Edge->>HS: Reverse proxy /machine/register and control-plane traffic
  HS-->>Operator: Node registered in user alex
  Operator->>HS: Revoke temporary preauth key after enrollment
```

## Current inventory

| Component | Current state |
| --- | --- |
| Public server | Hetzner dedicated server `167.235.12.22` |
| Host OS | Proxmox VE 9 on Debian 13/Trixie |
| Hostname | `proxmox`; operationally referred to as `nazar` |
| Public DNS | `nazar.studio`, `www.nazar.studio`, `headscale.nazar.studio` all point to `167.235.12.22` |
| Public ingress | Proxmox nftables forwards `80/tcp` and `443/tcp` to edge VM `10.10.10.10` |
| SSH ingress | `22/tcp` to Proxmox host |
| Private bridge | `vmbr1`, host gateway `10.10.10.1/24` |
| Edge VM | VM 100 `edge`, NixOS, `10.10.10.10`, Caddy, Tailscale subnet router, tailnet IP `100.64.0.2` |
| Headscale VM | VM 101 `headscale`, NixOS, `10.10.10.11`, Headscale on `8080` |
| Headscale state | `/var/lib/headscale`, SQLite database |
| Enrolled tailnet nodes | `alex-laptop` user device `100.64.0.1`; `edge` subnet router `100.64.0.2` |
| Private subnet route | `10.10.10.0/24` is advertised by `edge`, approved in Headscale, and accepted by `alex-laptop` |
| Next planned service | Forgejo on the private service network |

## Maintenance rule

When changing infrastructure, update this diagram and inventory alongside the implementation/runbook changes. In particular, update this file whenever any of the following change:

- DNS names or public endpoints.
- Public port exposure or DNAT/firewall rules.
- Proxmox bridges, VM IDs, private IPs, or guest roles.
- Caddy reverse proxy routes.
- Tailnet enrollment, subnet-router, or private-access flows.
- Repository layout or deployment source of truth.
