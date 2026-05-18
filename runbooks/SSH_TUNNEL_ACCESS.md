# SSH Tunnel Access Runbook

OpenSSH local forwarding is the canonical browser access path for Nazar.

## Relationship To Tailscale

SSH local forwarding remains the fallback/admin path. For phone and desktop apps
that need persistent CalDAV/WebDAV sync, prefer Tailscale private access; mobile
CalDAV/WebDAV clients generally cannot use SSH tunnels reliably for background
sync. Keep the SSH tunnel for loopback-only services such as the Hermes
Dashboard until a deliberate tailnet reverse-proxy/auth design exists.

## Server Model

- Public endpoint: `alex@167.235.12.22:22`
- SSH policy: key-only, `alex` only, root login disabled
- Public firewall: SSH only
- Browser services bind on host loopback

The server does not expose HTTP publicly. The laptop opens local ports and forwards them over SSH to host loopback ports.

## Laptop Model

`nix/modules/laptop/nazar-tunnel.nix` declares:

- `programs.ssh` host alias `nazar-tunnel`
- pinned Nazar SSH host key
- `nazar-tunnel.service`
- local forward for the Hermes Dashboard

The service is gated by:

```text
ConditionPathExists=/home/alex/.ssh/id_ed25519
```

so the laptop config can be applied without committing the private key.

## Client Key Setup

Use the existing laptop private key if its public half is already listed in:

```text
nix/users/alex-public-ssh-keys.nix
```

The default laptop configuration expects the matching private key at:

```text
/home/alex/.ssh/id_ed25519
```

If the private key has a different filename, override `nazar.access.tunnel.keyPath` in the laptop host config. If adding a new laptop key, commit only the public key to `nix/users/alex-public-ssh-keys.nix`, deploy the host, then rebuild the laptop.

## Start And Check

```bash
sudo nixos-rebuild switch --flake .#alex-laptop
systemctl status nazar-tunnel
```

The generated command is equivalent to:

```bash
ssh -N -T \
  -L 127.0.0.1:9119:127.0.0.1:9119 \
  nazar-tunnel
```

## Access Services

```bash
curl -I http://127.0.0.1:9119/
```

## Troubleshooting

Check laptop service logs:

```bash
journalctl -u nazar-tunnel -n 100 --no-pager
```

Check the SSH control path:

```bash
ssh -v nazar-tunnel true
```

Check host services:

```bash
systemctl is-active sshd systemd-networkd hermes-agent hermes-dashboard
```
