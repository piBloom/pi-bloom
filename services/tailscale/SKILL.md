---
name: tailscale
version: 0.1.0
description: Secure mesh networking via Tailscale — zero-config VPN for accessing Bloom remotely
image: docker.io/tailscale/tailscale@sha256:95e528798bebe75f39b10e74e7051cf51188ee615934f232ba7ad06a3390ffa1
---

# Tailscale Service

Provides secure remote access to Bloom via Tailscale's mesh VPN. Once connected, access Bloom from anywhere on your tailnet.

## Setup

After installing and starting the service:

```bash
# Check auth status
podman exec bloom-tailscale tailscale status

# Authenticate (first time)
podman exec bloom-tailscale tailscale up
# Follow the URL to authenticate in browser
```

## Common Commands

```bash
# Check connection status
podman exec bloom-tailscale tailscale status

# Show this device's IP
podman exec bloom-tailscale tailscale ip

# List connected devices
podman exec bloom-tailscale tailscale status --json | jq '.Peer | to_entries[] | .value.HostName'

# Ping another device
podman exec bloom-tailscale tailscale ping <hostname>

# Disconnect
podman exec bloom-tailscale tailscale down
```

## Notes

- Uses userspace networking mode (no kernel module needed)
- Requires NET_ADMIN and NET_RAW capabilities
- Persistent state in bloom-tailscale-state volume
- Free tier supports up to 100 devices
