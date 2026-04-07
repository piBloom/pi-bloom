# Security Model

> Security perimeter and threat model

## Audience

Operators deploying NixPI and template forkers who need to understand the security perimeter and threat model.

## Core Security Model

**WireGuard is the load-bearing remote-access boundary.**

NixPI is designed as a NixOS-based personal AI-first OS where the primary operator path is a native WireGuard interface. This is explicitly codified in the firewall configuration:

```nix
networking.firewall.interfaces.wg0.allowedTCPPorts = [ 80 443 ];
```

The `wg0` interface is the WireGuard tunnel interface. Only WireGuard peers can reach the remote NixPI app surface. Everything behind the tunnel is relatively trusted.

## What WireGuard Protects

When WireGuard is active and the `wg0` interface is up, the following services are accessible **only** to WireGuard peers:

| Service | Port | Purpose |
|---------|------|---------|
| Web app | `:80`, `:443` | Primary remote chat and terminal entrypoint |
| Browser terminal | `/terminal/` via nginx | Operator shell access |
| Internal backend probe | `127.0.0.1:8080` | Host-local health check for `nixpi-chat.service` |

## What Happens If WireGuard Peers Are Missing

If WireGuard is enabled but you have not configured any peers yet:

1. The `wg0` interface may still exist locally, but no remote device can use it
2. The app ports remain closed on untrusted interfaces when `nixpi.security.enforceServiceFirewall = true`
3. The public exposure is limited to SSH and the WireGuard UDP listen port
4. Remote browser access is unavailable until you add at least one trusted peer

This is an availability problem, not a silent app exposure, as long as the interface-restricted firewall remains enabled.

## Threat Actors Within Scope

The security model addresses the following threats:

1. **Compromised device on the WireGuard network** — A peer that has been compromised can attempt to interact with NixPI services or brute-force SSH.

2. **Compromised service container** — A container running on the host (inside the mesh) that has been compromised can attempt to pivot to the host or manipulate NixPI state.

3. **Template forker without WireGuard peers** — A user who deploys NixPI without configuring any WireGuard peers will not have the intended remote operator path and will fall back to SSH-only administration.

## SSH Access

By default:

- Password authentication is disabled
- Public key authentication is enabled
- Root login is disabled
- The installed desktop profile keeps SSH available after setup for remote administration and VM debugging
- SSH logins are restricted to the primary operator account by default

Recommended hardening after first boot:

```bash
# Add your SSH public key
mkdir -p ~/.ssh
chmod 700 ~/.ssh
echo "ssh-ed25519 AAAAC3... your-key" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys

# Then disable password login and keep only key-based SSH access
```

## Agent Privilege Boundary

- The primary operator account is the normal human and Pi runtime identity
- Interactive Pi state lives in `~/.pi`, while service and secret state lives under `/var/lib/nixpi`
- The human operator keeps full OS administration through their own account
- NixPI agent actions no longer rely on blanket passwordless sudo
- Privileged actions are routed through the root-owned `nixpi-broker` service

Default autonomy:

- `observe` can read state only
- `maintain` can operate approved NixPI systemd units
- `admin` is available only through temporary elevation

Temporary elevation is managed with:

```bash
sudo nixpi-brokerctl grant-admin 30m
sudo nixpi-brokerctl status
sudo nixpi-brokerctl revoke-admin
```

There is no separate first-boot helper sudo surface anymore. Privileged operations should go through normal `sudo` or the broker service.

## Pre-Deployment Checklist

Before exposing a NixPI host to any network:

- [ ] `wireguard-wg0.service` is active
- [ ] The `wg0` interface exists (`ip link show wg0`)
- [ ] `wg show wg0` lists your expected peers
- [ ] You have verified services are NOT accessible from non-WireGuard devices
- [ ] SSH keys are provisioned (recommended)

## Related

- [First Boot Setup](../operations/first-boot-setup)
- [Quick Deploy](../operations/quick-deploy)
- [Supply Chain](./supply-chain)
