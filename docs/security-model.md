# nixPI Security Model

> 📖 [Emoji Legend](LEGEND.md)

Audience: operators deploying nixPI and template forkers who need to understand
the security perimeter and threat model.

---

## 🌱 Core Security Model

**NetBird is the load-bearing security boundary.**

nixPI is designed as a NixOS-based personal AI-first OS where the primary
security perimeter is a NetBird WireGuard mesh network. This is explicitly
codified in the firewall configuration:

```nix
networking.firewall.trustedInterfaces = [ "wt0" ];
```

The `wt0` interface is the NetBird tunnel interface. Only mesh peers can reach
nixPI services. Everything behind the mesh is relatively trusted.

---

## 🛡️ What NetBird Protects

When NetBird is active and the `wt0` interface is up, the following services
are accessible **only** to peers on the NetBird mesh:

| Service | Port | Purpose |
|---------|------|---------|
| Home | 8080 | Landing page with service links |
| Matrix | 6167 | Homeserver for messaging |
| dufs (WebDAV) | 5000 | File server for `~/Public/Workspace` |
| code-server | 8443 | Browser-based code editor |
| fluffychat | 8081 | Web Matrix client |

---

## ⚠️ What Happens If NetBird Is Absent

If NetBird is not running or not configured:

1. The `wt0` interface does not exist
2. The firewall rule `trustedInterfaces = ["wt0"]` provides **no protection**
3. All nixPI services are exposed to the **local network**
4. Any device on the same network can:
   - Access the Matrix homeserver
   - Interact with Pi in Matrix rooms
   - Potentially trigger OS tools (`nixos_update`, `systemd_control`)
     via prompt injection

**This is a complete loss of the security perimeter.**

---

## 🎯 Threat Actors Within Scope

The security model addresses the following threats:

1. **Compromised device on the NetBird mesh** — A peer that has been compromised
can attempt to interact with nixPI services or brute-force SSH.

2. **Compromised service container** — A container running on the host (inside
the mesh) that has been compromised can attempt to pivot to the host or
manipulate nixPI state.

3. **Template forker without NetBird** — A user who deploys nixPI without
configuring NetBird or with it misconfigured has no security perimeter and
is fully exposed to the local network.

---

## 🔐 SSH Access

By default:
- Password authentication is enabled for initial setup
- Public key authentication is **enabled** (you should provision keys after first boot)
- Root login is disabled

Recommended hardening after first boot:
```bash
# Add your SSH public key
mkdir -p ~/.ssh
chmod 700 ~/.ssh
echo "ssh-ed25519 AAAAC3... your-key" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys

# Then disable password auth (requires flake change) or rely on key-only
```

---

## 📋 Pre-Deployment Checklist

Before exposing a nixPI host to any network:

- [ ] NetBird is enrolled and connected (`netbird status` shows "Connected")
- [ ] The `wt0` interface exists (`ip link show wt0`)
- [ ] You have verified services are NOT accessible from non-mesh devices
- [ ] SSH keys are provisioned (recommended)

---

## 🔗 Related

- [first-boot-setup.md](first-boot-setup.md) — First-boot setup guide
- [quick_deploy.md](quick_deploy.md) — Build and deployment guide
- [supply-chain.md](supply-chain.md) — Image trust policy
- [../AGENTS.md](../AGENTS.md) — Reference for sensitive paths
