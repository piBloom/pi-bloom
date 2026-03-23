# Security Model

> Security perimeter and threat model

## Audience

Operators deploying NixPI and template forkers who need to understand the security perimeter and threat model.

## Core Security Model

**NetBird is the load-bearing security boundary.**

NixPI is designed as a NixOS-based personal AI-first OS where the primary security perimeter is a NetBird WireGuard mesh network. This is explicitly codified in the firewall configuration:

```nix
networking.firewall.trustedInterfaces = [ "wt0" ];
```

The `wt0` interface is the NetBird tunnel interface. Only mesh peers can reach NixPI services. Everything behind the mesh is relatively trusted.

## What NetBird Protects

When NetBird is active and the `wt0` interface is up, the following services are accessible **only** to peers on the NetBird mesh:

| Service | Port | Purpose |
|---------|------|---------|
| Home | 8080 | Minimal service directory with shareable access URLs |
| Matrix | 6167 | Homeserver for messaging |
| element-web | 8081 | Web Matrix client |

## What Happens If NetBird Is Absent

If NetBird is not running or not configured:

1. The `wt0` interface does not exist
2. The firewall rule `trustedInterfaces = ["wt0"]` provides **no protection**
3. All NixPI services are exposed to the **local network**
4. Any device on the same network can access the Matrix homeserver, interact with Pi in Matrix rooms, and potentially trigger OS tools (`nixos_update`, `systemd_control`) via prompt injection

**This is a complete loss of the security perimeter.**

## Threat Actors Within Scope

The security model addresses the following threats:

1. **Compromised device on the NetBird mesh** — A peer that has been compromised can attempt to interact with NixPI services or brute-force SSH.

2. **Compromised service container** — A container running on the host (inside the mesh) that has been compromised can attempt to pivot to the host or manipulate NixPI state.

3. **Template forker without NetBird** — A user who deploys NixPI without configuring NetBird or with it misconfigured has no security perimeter and is fully exposed to the local network.

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

Bootstrap-only passwordless sudo is also gated on setup state. The narrow first-boot helper commands stop working once `~/.nixpi/.setup-complete` exists.

## Pre-Deployment Checklist

Before exposing a NixPI host to any network:

- [ ] NetBird is enrolled and connected (`netbird status` shows "Connected")
- [ ] The `wt0` interface exists (`ip link show wt0`)
- [ ] You have verified services are NOT accessible from non-mesh devices
- [ ] SSH keys are provisioned (recommended)

## Related

- [First Boot Setup](../operations/first-boot-setup)
- [Quick Deploy](../operations/quick-deploy)
- [Supply Chain](./supply-chain)
