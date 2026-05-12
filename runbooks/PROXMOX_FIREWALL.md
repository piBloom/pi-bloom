# Proxmox Firewall Runbook

## Current state

Native Proxmox VE firewall is enabled for node `nazar`.

Config files:

```text
/etc/pve/firewall/cluster.fw
/etc/pve/local/host.fw
```

The older custom public lockdown service remains enabled as defense in depth:

```text
/usr/local/sbin/ownloom-public-lockdown
/etc/systemd/system/ownloom-public-lockdown.service
```

## Policy intent

Inbound default is deny for the Proxmox host. Explicitly allowed:

```text
Public NIC enp0s31f6:
  UDP 51820     NetBird/WireGuard overlay listener
  TCP 80        public Minecraft landing page reverse proxy to VM 110
  TCP 25565     optional Minecraft forward to VM 110 when enabled
  UDP 24454     optional Simple Voice Chat forward to VM 110 when enabled
  TCP 22        intentionally denied; public SSH is disabled in normal boot

NetBird interface wt0:
  TCP 22        SSH over NetBird
  TCP 80        NetBird-only nginx virtual hosts: git.nazar.studio and HTTP->HTTPS redirects
  TCP 443       NetBird-only nginx HTTPS virtual hosts: nazar.studio dashboard/Zellij and pve.nazar.studio
  TCP 8006      Proxmox UI over NetBird/private DNS direct fallback
  TCP 10022     Forgejo Git SSH proxy to VM 101
  TCP 3128      SPICE proxy over NetBird if needed
  TCP/UDP 53    NetBird local DNS listener

Private VM bridge vmbr1:
  UDP 67        DHCP for VM NAT bridge

General:
  ICMP/ICMPv6   diagnostics and required IPv6 behavior
```

The Proxmox built-in `management` ipset is pinned to the NetBird overlay:

```text
local_network 100.124.0.0/16
```

This avoids Proxmox auto-detecting the public Hetzner IPv6 `/64` as the management network.

## Validate

```bash
pve-firewall status
pve-firewall compile
systemctl status pve-firewall --no-pager
grep -E 'dport (80|25565|24454)' /etc/pve/local/host.fw
iptables -L INPUT -n -v --line-numbers
ip6tables -L INPUT -n -v --line-numbers
iptables -t nat -L PREROUTING -n -v --line-numbers | grep -E '25565|24454'
iptables -L FORWARD -n -v --line-numbers | grep -E '25565|24454'
```

Expected access:

```bash
curl -k --connect-timeout 5 https://nazar.studio/           # private dashboard from NetBird client
curl -k --connect-timeout 5 https://nazar.studio/zellij/    # Zellij web login from NetBird client
curl -k --connect-timeout 5 https://pve.nazar.studio/       # Proxmox UI from NetBird client; self-signed cert for now
curl --connect-timeout 5 http://git.nazar.studio/             # Forgejo web UI from NetBird client
curl -k --connect-timeout 5 https://100.124.51.27:8006/      # direct Proxmox overlay fallback
netbird ssh root@nazar                                        # OK over NetBird SSH
ssh nazar-public                                              # expected to time out in normal boot
```

Expected public exposure:

```text
Public Proxmox UI/SPICE/VNC/RDP: blocked
Public SSH: blocked
Public NetBird UDP listener: allowed
Public Minecraft landing page TCP/80: allowed via host nginx reverse proxy to VM 110
Public Minecraft TCP/25565: allowed only if minecraft-public-forward.service is enabled
Public Simple Voice Chat UDP/24454: allowed only if minecraft-public-forward.service is enabled
```

## Rollback

If the firewall blocks access but SSH/Rescue is available:

```bash
pve-firewall stop
```

To disable native Proxmox firewall persistently:

```bash
perl -0pi -e 's/^enable: 1$/enable: 0/m' /etc/pve/firewall/cluster.fw
perl -0pi -e 's/^enable: 1$/enable: 0/m' /etc/pve/local/host.fw
pve-firewall restart || true
```

Keep or re-enable the custom lockdown service if native firewall is stopped:

```bash
systemctl enable --now ownloom-public-lockdown.service
/usr/local/sbin/ownloom-public-lockdown add enp0s31f6
```

## Notes

- Public SSH was removed after a successful Hetzner Rescue drill. Use `runbooks/RESCUE_DRILL.md` for break-glass recovery.
- Do not expose Proxmox UI publicly.
- `pve.nazar.studio`, `git.nazar.studio`, and Forgejo SSH are intended to be NetBird-only. Overlay peers receive private `nazar.studio` answers from the NetBird Custom Zone; public exposure must remain an explicit reverse-proxy or forwarding decision.
- Re-check rules after NetBird interface/port changes or if additional VMs/services are added.
