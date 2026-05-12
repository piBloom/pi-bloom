# Domain and TLS Setup

This runbook documents the private domain and TLS setup for the Proxmox host, private Forgejo Git server, and NetBird-private OwnLoom services.

Current canonical naming is `nazar.studio`. Older sections that mention `pve.ownloom.com`, `ownloom.com`, or `nb.ownloom.com` are retained only as historical/legacy ACME notes unless explicitly marked current.

## Goals

- Use `nazar.studio` as the simple canonical infrastructure domain.
- Keep services NetBird-private by default; public access is an explicit per-service toggle.
- Use NetBird Custom Zone `nazar.studio` for private/split-horizon DNS.
- Use Gandi public wildcard `*.nazar.studio -> eu1.netbird.services.` only for NetBird Reverse Proxy public toggles.
- Do not expose Proxmox, Forgejo, OwnLoom, or OwnLoom Data publicly unless that target VM/service has first been hardened for public traffic.
- Use DNS-01 validation later when trusted certificates are wanted for `nazar.studio`, so no public HTTP/HTTPS ports are needed for private-only access.

## Domains configured

NetBird Custom Zone:

```text
nazar.studio          -> 100.124.51.27  # private dashboard and /zellij/ via NetBird-only nginx
pve.nazar.studio      -> 100.124.51.27  # Proxmox UI via NetBird-only nginx; HTTP redirects to HTTPS
git.nazar.studio      -> 100.124.51.27  # Forgejo web via NetBird-only nginx on :80 and Git SSH on :10022
ownloom.nazar.studio  -> 100.124.202.128
data.nazar.studio     -> 100.124.7.246   # DAV/wiki data backend
mc.nazar.studio       -> 100.124.51.27  # NetBird-private Minecraft forward through nazar
```

Public DNS / Reverse Proxy:

```text
*.nazar.studio CNAME eu1.netbird.services.
```

NetBird Reverse Proxy services exist for `pve`, `git`, `ownloom`, and `data`, but are disabled by default.

## What these point to

```text
nazar.studio
  -> Proxmox host NetBird IP, then local NetBird-bound nginx
  -> NetBird IP: 100.124.51.27
  -> Private dashboard: https://nazar.studio/
  -> Zellij web terminal: https://nazar.studio/zellij/

pve.nazar.studio
  -> Proxmox host NetBird IP, then local NetBird-bound nginx proxy to pveproxy
  -> NetBird IP: 100.124.51.27
  -> Proxmox UI: https://pve.nazar.studio/

git.nazar.studio
  -> Proxmox host NetBird IP, then local NetBird-bound nginx proxy to Git VM 101
  -> NetBird IP: 100.124.51.27
  -> Forgejo web: http://git.nazar.studio/
  -> Git SSH: ssh://git@git.nazar.studio:10022/nazar/nazar.git

ownloom.nazar.studio
  -> OwnLoom VM NetBird IP
  -> NetBird IP: 100.124.202.128
  -> private app/agent/wiki frontend when enabled

data.nazar.studio
  -> OwnLoom Data VM NetBird IP
  -> NetBird IP: 100.124.7.246
  -> private DAV/wiki data backend

mc.nazar.studio
  -> Proxmox host NetBird IP, then wt0-bound forwarding to Minecraft VM 110
  -> NetBird IP: 100.124.51.27
  -> Minecraft: TCP/25565, voice: UDP/24454
```

## Why these are A records

An A record maps a DNS name to an IPv4 address.

For example:

```text
pve.ownloom.com -> 100.124.51.27
```

The IPs used here are NetBird overlay IPs. They are not normal public web-service IPs. Public DNS can resolve public records such as `pve.ownloom.com`, but only devices connected to the NetBird network with matching policy can actually reach the services. New private-only infrastructure records should prefer the current NetBird Custom Zone `nazar.studio`, which is distributed inside the overlay. The older `nb.ownloom.com` zone is historical/rollback metadata only.

## DNS records added

### `nazar.studio` records

Registrar/DNS provider: Gandi LiveDNS.

```text
Type: A
Name: pve
Value: 100.124.51.27
TTL: 300 or provider default
```

```text
Type: A
Name: git
Value: 100.124.51.27
TTL: 300 or provider default
```

These are private-service records. They are in public DNS, but the target IP is a NetBird overlay address and is only reachable from NetBird-connected clients with matching ACLs.

### `ownloom.com` records

DNS provider: Hetzner Console.

```text
Type: A
Name: pve
Value: 100.124.51.27
TTL: 300
```

No VM-specific public DNS records are canonical. VM shell access goes through `netbird ssh root@nazar`, then `ssh alex@<vm-name>` private NAT aliases from `nazar`.

No AAAA records were added for these private admin names because NetBird is currently using IPv4 overlay addresses.

For `nazar.studio`, keep service records pointed at NetBird overlay IPs only. Do not point `git.nazar.studio` or `pve.nazar.studio` at the public Hetzner IP `167.235.12.22` unless intentionally making them public later.

## Public records intentionally not changed

The existing public/root website and mail-related records were not changed:

```text
A      ownloom.com
A      www.ownloom.com
AAAA   ownloom.com
AAAA   www.ownloom.com
MX     ownloom.com
TXT    SPF
SRV    mail/autodiscovery records
```

## Verification performed

DNS resolution was verified through:

```text
local resolver
Cloudflare 1.1.1.1
Google 8.8.8.8
```

Expected public/private DNS results:

```text
pve.nazar.studio          -> 100.124.51.27
git.nazar.studio         -> 100.124.51.27
pve.ownloom.com           -> 100.124.51.27
```

Expected NetBird Custom Zone results on peers with NetBird DNS enabled:

```text
nazar.studio           -> 100.124.51.27
pve.nazar.studio       -> 100.124.51.27
git.nazar.studio       -> 100.124.51.27
ownloom.nazar.studio   -> 100.124.202.128
data.nazar.studio      -> 100.124.7.246
mc.nazar.studio        -> 100.124.51.27
```

Connectivity verified:

```text
https://pve.nazar.studio/       -> HTTP 200 over NetBird with accepted self-signed cert
http://git.nazar.studio/        -> Forgejo web UI over NetBird
git ls-remote Forgejo SSH URL   -> lists nazar/nazar refs after user SSH key is added
https://pve.ownloom.com:8006    -> legacy HTTP 200 over NetBird with Let's Encrypt cert while retained
http://data.nazar.studio/       -> OwnLoom data VM over NetBird from allowed peers
```

## TLS certificate setup

The Proxmox UI originally used the default Proxmox self-signed certificate. That caused browser warnings for:

```text
https://pve.ownloom.com:8006
```

A trusted Let's Encrypt certificate was configured using ACME DNS-01.

## What ACME is

ACME means:

```text
Automatic Certificate Management Environment
```

It is the protocol used by Let's Encrypt and Proxmox to automatically issue and renew TLS certificates.

## Why DNS-01 was used

HTTP-01 validation would require Let's Encrypt to connect to a public HTTP endpoint.

DNS-01 instead proves domain ownership by creating a temporary TXT record like:

```text
_acme-challenge.pve.ownloom.com
```

This means:

- public Proxmox UI remains blocked;
- no public port 80 is required;
- no public port 443 is required;
- no public port 8006 is required;
- certificate renewal can still be automated.

## Hetzner Console API token

A Hetzner Console project API token was created for DNS automation.

```text
Permission: Read & Write
Purpose: create/delete temporary ACME TXT records
```

The token is stored in Proxmox ACME plugin configuration and is intentionally not documented here.

Important: do not delete this token unless it is also replaced in Proxmox. It is needed for automatic renewal.

## Proxmox ACME configuration

```text
ACME account: default
DNS plugin ID: hetznercloud-ownloom
DNS API: hetznercloud
Validation delay: 120 seconds
API data variable: HETZNER_TOKEN
ACME domain: pve.ownloom.com
```

## Certificate result

The Proxmox UI now serves a trusted Let's Encrypt certificate.

Verified result:

```text
URL: https://pve.ownloom.com:8006
HTTP: 200
TLS verification: OK
Subject/CN: pve.ownloom.com
Issuer: Let's Encrypt R13
SAN: pve.ownloom.com
Valid from: 2026-05-10
Valid until: 2026-08-08
```

Proxmox shows the browser-facing certificate as:

```text
pveproxy-ssl.pem
```

The internal Proxmox CA and `pve-ssl.pem` still exist. That is normal. The web UI uses the custom ACME certificate via `pveproxy-ssl.pem`.

## `nazar.studio` private dashboard and `pve.nazar.studio` HTTPS

`nazar.studio` is the NetBird-only private dashboard. `pve.nazar.studio` is the dedicated Proxmox UI alias.

Both names intentionally use the same self-signed certificate for now.

Why HTTPS is required:

```text
Proxmox sets secure auth cookies.
Plain HTTP login via http://pve.nazar.studio/ causes browser-side cookie issues and errors like: 401: No ticket.
```

Current behavior:

```text
http://nazar.studio/       -> 301 redirect to https://nazar.studio/
https://nazar.studio/      -> nginx on 100.124.51.27:443 -> /var/www/nazar-dashboard
https://nazar.studio/zellij/ -> nginx on 100.124.51.27:443 -> http://127.0.0.1:8082
http://pve.nazar.studio/   -> 301 redirect to https://pve.nazar.studio/
https://pve.nazar.studio/  -> nginx on 100.124.51.27:443 -> https://127.0.0.1:8006
```

Self-signed certificate files:

```text
/etc/ssl/certs/pve.nazar.studio.crt
/etc/ssl/private/pve.nazar.studio.key
```

Nginx private vhost config:

```text
/etc/nginx/sites-available/netbird-private.conf
/etc/nginx/sites-enabled/netbird-private.conf
```

Important: nginx listens only on the NetBird overlay IP for these vhosts:

```text
100.124.51.27:80
100.124.51.27:443
```

This is separate from Proxmox's existing trusted `pve.ownloom.com` ACME certificate. The `pve.ownloom.com` certificate was not removed or replaced.

## `git.nazar.studio` private Forgejo routing

`git.nazar.studio` points to the Proxmox host's NetBird IP and is routed by NetBird-only nginx/socat to the NixOS Forgejo VM:

```text
http://git.nazar.studio/ -> nginx 100.124.51.27:80 -> 10.10.10.21:3000
ssh://git@git.nazar.studio:10022/nazar/nazar.git -> socat 100.124.51.27:10022 -> 10.10.10.21:10022
```

See `runbooks/FORGEJO_GIT_VM.md` for the Forgejo VM and repo bootstrap details.

## Current access URLs

Private Forgejo:

```text
http://git.nazar.studio/
ssh://git@git.nazar.studio:10022/nazar/nazar.git
```

Private dashboard and preferred Proxmox UI:

```text
https://nazar.studio/
https://nazar.studio/zellij/
https://pve.nazar.studio/
```

See `runbooks/NAZAR_PRIVATE_DASHBOARD.md` for Zellij token and service operations.

`http://pve.nazar.studio/` redirects to HTTPS because Proxmox uses secure auth cookies; plain HTTP causes login failures like `401: No ticket`.

Existing Ownloom Proxmox UI alias:

```text
https://pve.ownloom.com:8006
```

Fallback Proxmox UI by NetBird IP:

```text
https://100.124.51.27:8006
```

Canonical shell access:

```bash
netbird ssh root@nazar
```

Root logins on `nazar` open a plain shell. If you want the persistent Zellij workspace, use `https://nazar.studio/zellij/` with a Zellij token or run `zellij attach --create nazar`. Then use VM-name aliases over the private NAT bridge with the canonical NixOS VM admin user:

```bash
ssh alex@ownloom
ssh alex@ownloom-data
ssh alex@minecraft
ssh alex@git
```

VM passwords remain locked and normal access is key-only. Root VM SSH remains available key-only for break-glass and current compatibility.

Fallback/local aliases:

```bash
ssh nazar-public   # expected to time out in normal boot
```

## Public exposure status

Public direct Proxmox UI access remains blocked.

Blocked publicly on the Hetzner NIC:

```text
TCP 8006
TCP 3128
TCP 3389
TCP 5900-5999
```

The trusted certificate does not make Proxmox public. It only makes the private NetBird-accessed UI trusted by browsers.

## Renewal notes

Proxmox should renew the certificate automatically before expiry using:

```text
ACME account: default
DNS plugin: hetznercloud-ownloom
Hetzner API token stored in Proxmox
```

If renewal fails later, check:

- Hetzner token still exists;
- token has Read & Write permission;
- token belongs to the project containing `ownloom.com`;
- plugin still uses `hetznercloud`, not old `hetzner`;
- API data variable is `HETZNER_TOKEN`;
- DNS validation delay may need increasing.

## Safe verification commands

From a NetBird-connected client:

```bash
curl https://pve.ownloom.com:8006/
getent hosts pve.ownloom.com
getent hosts pve.nazar.studio data.nazar.studio git.nazar.studio
```

On Proxmox:

```bash
pvenode cert info
pvenode config get
pvenode acme account list
pvenode acme plugin list
```

Do not print or copy ACME plugin API data unless you intend to handle the token as a secret.
