# NetBird Access Runbook

## Peers

```text
Local desktop NetBird IP: 100.124.32.110
Local desktop FQDN:      evo-x1.netbird.cloud
Nazar NetBird IP:        100.124.51.27
Nazar FQDN:              nazar.netbird.cloud
Private dashboard DNS:   nazar.studio
Proxmox private DNS:     pve.nazar.studio
Forgejo private DNS:     git.nazar.studio
Git VM NAT IP:           10.10.10.21
Git VM NetBird IP:       100.124.135.247
Git VM NetBird FQDN:     git.netbird.cloud
Private HTTP(S) vhosts:  nginx on 100.124.51.27:80 and :443
Forgejo private endpoint:git.nazar.studio -> 100.124.51.27:80 -> 10.10.10.21:3000
Dashboard endpoint:     nazar.studio -> 100.124.51.27:443 -> /var/www/nazar-dashboard
Zellij web endpoint:    nazar.studio/zellij/ -> 100.124.51.27:443 -> 127.0.0.1:8082
Proxmox private endpoint:pve.nazar.studio -> 100.124.51.27:443 -> 127.0.0.1:8006
Forgejo Git SSH endpoint:100.124.51.27:10022 -> 10.10.10.21:10022
OwnLoom VM NetBird IP:   100.124.202.128
OwnLoom VM FQDN:         ownloom.netbird.cloud
OwnLoom VM NAT IP:       10.10.10.40
OwnLoom Data NetBird IP: 100.124.7.246
OwnLoom Data FQDN:       ownloom-data.netbird.cloud
OwnLoom Data NAT IP:     10.10.10.41
OwnLoom private DNS:     ownloom.nazar.studio, data.nazar.studio
Minecraft private DNS:   mc.nazar.studio
NetBird custom zone:     nazar.studio
NetBird private records: nazar.studio, pve.nazar.studio, git.nazar.studio,
                         ownloom.nazar.studio, data.nazar.studio, mc.nazar.studio
```

## Access

Private dashboard / Proxmox UI:

```text
https://nazar.studio/          # private dashboard + service links
https://nazar.studio/zellij/   # Zellij web terminal, token required
https://pve.nazar.studio/      # Proxmox UI alias
http://pve.nazar.studio/       # redirects to HTTPS
https://100.124.51.27:8006    # direct Proxmox fallback
```

Forgejo private Git server:

```text
http://git.nazar.studio/
ssh://git@git.nazar.studio:10022/nazar/nazar.git
```

Current host shell access:

```bash
netbird ssh alex@nazar
ssh alex@167.235.12.22   # fallback from personal secure devices with the dedicated OpenSSH key
```

SSH sessions on `nazar` open a plain shell by default. Zellij remains available both from the private dashboard and manually from SSH:

```text
https://nazar.studio/zellij/   # browser terminal, Zellij token required
```

```bash
zellij attach --create nazar
```

Public OpenSSH to `nazar` is key-only and limited to `alex`; root SSH is disabled. Devices without the dedicated `alex` OpenSSH key should use NetBird SSH. Root/bare-metal break-glass access is Hetzner Rescue; see `runbooks/RESCUE_DRILL.md`.

Canonical VM shell access:

```bash
netbird ssh alex@nazar
ssh alex@git
ssh alex@minecraft
ssh alex@ownloom
ssh alex@ownloom-data
```

These short VM names are `/etc/hosts` aliases on `nazar` for the private NAT bridge IPs. `ownloom-vault` is also reserved as an alias for `10.10.10.42`, but the VM is not deployed yet.

`alex` is the canonical NixOS VM admin user. VM passwords stay locked and normal SSH is key-only. Do not add a shared VM password; future console emergency passwords, if needed, must be unique per VM and delivered through encrypted `sops-nix`/secret material. Root VM SSH remains key-only for break-glass and current compatibility.

Fallback/local aliases:

```bash
ssh nazar-public      # expected to time out in normal boot; only useful if firewall is intentionally rolled back
ssh root@10.10.10.40  # raw ownloom NAT IP from Proxmox/private side, root break-glass
ssh root@10.10.10.41  # raw ownloom-data NAT IP from Proxmox/private side, root break-glass
```

Direct NetBird/OpenSSH to VM FQDNs is **not** a normal access path. VM shell administration goes through `nazar` and the private NAT aliases.

## Current NetBird names

The machines are correctly named at OS/Proxmox and NetBird level:

```text
nazar.netbird.cloud
ownloom.netbird.cloud
ownloom-data.netbird.cloud
evo-x1.netbird.cloud
nazar.studio
pve.nazar.studio
git.nazar.studio
ownloom.nazar.studio
data.nazar.studio
mc.nazar.studio
```

## Access control groups and policies

Configured peer groups:

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

Configured policies:

```text
admins-to-proxmox-services
  Source: admins
  Destination: proxmox-hosts
  Protocol: TCP
  Ports: 80, 443, 8006, 10022
  Direction: admins -> nazar only
  Purpose: private dashboard/Zellij web, Proxmox UI, and Forgejo SSH proxy access.
  Note: TCP/22 is intentionally excluded; use NetBird SSH for shell.

admins-to-minecraft-private
  Source: admins
  Destination: proxmox-hosts
  Protocol: TCP
  Ports: 25565
  Direction: admins -> nazar only
  Purpose: private Minecraft Java forwarding to VM 110.

admins-to-minecraft-voice-private
  Source: admins
  Destination: proxmox-hosts
  Protocol: UDP
  Ports: 24454
  Direction: admins -> nazar only
  Purpose: private Simple Voice Chat forwarding to VM 110.

admins-to-nazar-netbird-ssh
  Source: admins
  Destination: proxmox-hosts
  Protocol: NetBird SSH
  Authorized local users: alex
  Direction: admins -> nazar only
  Purpose: primary host shell access with NetBird/OIDC identity; root is not allowed.

admins-to-ownloom-data-dav
  Source: admins
  Destination: ownloom-data-services
  Protocol: TCP
  Ports: 80
  Direction: admins -> ownloom-data only
  Purpose: private DAV/bootstrap HTTP access; no VM SSH.

admins-to-ownloom-web
  Source: admins
  Destination: ownloom-core
  Protocol: TCP
  Ports: 80
  Direction: admins -> ownloom only
  Purpose: direct private browser access to OwnLoom and /zellij/ over NetBird; no VM SSH.

ownloom-to-ownloom-data-dav
  Source: ownloom-core
  Destination: ownloom-data-services
  Protocol: TCP
  Ports: 80
  Direction: ownloom -> ownloom-data only
  Purpose: VM 120 wiki/agent access to VM 121 DAV backend.
```

Temporary browser-client NetBird SSH policies may appear while a browser-based NetBird SSH session is active. Remove them only after confirming they are no longer needed.

## NetBird API token on Nazar

For narrowly scoped NetBird automation, store the token as a root-only runtime secret outside git:

```bash
install -d -m 700 -o root -g root /root/.nazar-secrets
sh -c 'umask 077; cat > /root/.nazar-secrets/netbird-api-token'
chmod 600 /root/.nazar-secrets/netbird-api-token
```

Scripts may read `/root/.nazar-secrets/netbird-api-token` by default, or a custom path via `NETBIRD_TOKEN_FILE`. Do not put NetBird API tokens in `.bashrc`, shell history, committed files, or world-readable environments. Prefer short-lived/service-user tokens with minimum permissions, and revoke them after one-off work when practical.

Current helpers:

```bash
/root/nazar/scripts/netbird/ensure-nazar-access.py
/root/nazar/scripts/netbird/ensure-ownloom-direct.py
```

`ensure-nazar-access.py` reconciles the baseline groups, `admins -> nazar` NetBird SSH policy with local-user mapping to `alex`, private host service policies, `nazar.studio` custom-zone host records, and can generate a one-off setup key for `nixos-anywhere --extra-files`. `ensure-ownloom-direct.py` remains a narrow OwnLoom direct-web helper.

## NetBird DNS custom zone

Configured Custom Zone:

```text
Zone: nazar.studio
Distributed to: admins, proxmox-hosts, vms
Search domain: disabled
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

The old `nb.ownloom.com` zone is disabled and kept only as historical/rollback metadata. Public Gandi DNS uses `*.nazar.studio -> eu1.netbird.services.` for the NetBird Reverse Proxy wildcard, while NetBird peers receive the private `nazar.studio` answers above.

Caution: because `nazar.studio` is a whole-zone NetBird override for enrolled peers, missing-record fallback behavior can vary by NetBird version/client. Before adding public records under the same apex, test resolution from both NetBird and non-NetBird clients; duplicate any public records that overlay peers must still resolve, or prefer a separate private sub-zone for future expansion.

## Public exposure rule

Default state is private: use NetBird DNS, NetBird policies, and disabled Reverse Proxy services. Only enable a public Reverse Proxy service or public port-forward after the target VM/service is hardened for public traffic.

Minimum public-readiness gate:

```text
- application auth/authorization is configured;
- TLS is in place through the proxy or service;
- only required ports/paths are exposed;
- admin/debug/setup endpoints are not public;
- backups and restore path are tested for stateful services;
- logging/alerting exists;
- rollback is known: disable the Reverse Proxy service or stop the public-forward unit.
```

If the service is not intentionally being shared yet, leave it as NetBird-private and do not harden it for hypothetical public use.

## NetBird roadmap

Near-term hardening:

1. The API token used for the 2026-05-11 policy update was revoked after use. Mint future tokens only as short-lived service-user tokens.
2. Remove temporary browser-client NetBird SSH policies once browser SSH sessions are no longer active.
3. Decide whether `s25ultra` should join the `admins` group; it is not currently an admin peer.
4. Configure NetBird SSH fine-grained access in the dashboard so the admin user/group maps only to the intended local user(s), currently `root` on `nazar`; avoid broad “full access” mappings.
5. Add posture checks for admin policies if desired: OS/version, login expiration, or approved-device checks.
6. Keep one-time setup keys short-lived and assigned to the correct auto-groups.

Future service mesh options:

1. Move OwnLoom Data DAV to HTTPS and update policies from TCP/80 to TCP/443.
2. If VMs should eventually not run NetBird clients, create a NetBird Network with `nazar` as router for selected `10.10.10.0/24` resources, masquerade enabled, and resource-specific policies. Do not expose the whole subnet unless explicitly needed.
3. Keep VM shell access through `nazar`; avoid direct admin-to-VM TCP/22 policies.

Verified from `EVO-X1` / active admin sessions:

```text
netbird ssh root@nazar -> OK
https://nazar.studio/ -> private dashboard after accepting self-signed cert
https://nazar.studio/zellij/ -> Zellij web login after accepting self-signed cert
https://pve.nazar.studio/ -> Proxmox UI after accepting self-signed cert
http://git.nazar.studio/ -> Forgejo web UI
ssh nazar-public -> timed out as expected
```

OwnLoom VMs are enrolled in NetBird for private service access and diagnostics, but NetBird SSH is canonical only on `nazar`. VM admin shell access is `netbird ssh root@nazar` followed by `ssh alex@ownloom` or `ssh alex@ownloom-data` from the Proxmox host.

The current policy set is least-privilege: no default all-to-all policy, no admin-to-VM TCP/22 policy, and no NetBird SSH on VMs.

## Verify local NetBird

```bash
netbird status
ip -br addr show wt0
```

## Verify Proxmox NetBird

```bash
netbird ssh root@nazar
netbird status
```

## Verify VM shell access from `nazar`

```bash
netbird ssh root@nazar
getent hosts git minecraft ownloom ownloom-data ownloom-vault
ssh alex@ownloom 'hostname; whoami; sudo systemctl --failed --no-pager'
ssh alex@ownloom 'pi --version; ownloom-context --format json | head'
ssh alex@ownloom-data 'hostname; whoami; systemctl is-active radicale nginx'
ssh alex@ownloom-data 'curl -fsS http://127.0.0.1/ | head'
ssh alex@ownloom-data 'curl -fsS -X OPTIONS -i http://127.0.0.1/files/ | head'
```

## Verify OwnLoom private DAV over NetBird

From VM 120 (`ownloom`) or an admin peer in the `admins` NetBird group:

```bash
getent hosts data.nazar.studio
curl -fsS http://data.nazar.studio/ | head
curl -fsS -X OPTIONS -i http://data.nazar.studio/files/ | head
```

`nazar` itself was joined with NetBird DNS disabled, so use its `/etc/hosts` VM aliases for shell access and run service checks inside the VM when on `nazar`.

## If NetBird on VM breaks

Use the canonical NAT path from `nazar`:

```bash
ssh alex@ownloom
ssh alex@ownloom-data
```

Or use raw NAT IPs with key-only root break-glass if aliases or `alex` access are broken:

```bash
ssh root@10.10.10.40
ssh root@10.10.10.41
```

This connects from the Proxmox/private side to the VM NAT bridge addresses.

## Re-joining a peer

Create a one-time NetBird setup key in the dashboard. Use short expiration and usage limit 1.

Then run on the target machine.

For Proxmox, keep NetBird DNS disabled so the host resolver remains simple and predictable:

```bash
netbird up --setup-key 'SETUP_KEY_HERE' --hostname nazar --disable-dns
```

For OwnLoom VMs, keep NetBird DNS enabled so `nazar.studio` custom-zone names resolve inside the private service mesh:

```bash
netbird up --setup-key 'SETUP_KEY_HERE' --hostname ownloom
netbird up --setup-key 'SETUP_KEY_HERE' --hostname ownloom-data
```

Do not enable NetBird's embedded SSH server on VMs by default. Canonical admin shell access is through `nazar`, then regular OpenSSH to VM-name aliases on the private NAT bridge.

Revoke/delete setup keys after use.
