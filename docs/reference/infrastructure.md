# Infrastructure

> Runtime services and access infrastructure

## Operator-Facing Runtime

NixPI exposes a remote web app through the built-in host services.

### Configuration

| Setting | Value |
|---------|-------|
| Chat backend service | `nixpi-chat.service` |
| Browser terminal service | `nixpi-ttyd.service` |
| Public entrypoint | `nginx` on `/` and `/terminal/` |
| Internal backend probe | `http://127.0.0.1:8080/` |

### Troubleshooting

```bash
# Public surface
systemctl status nginx.service
systemctl status nixpi-ttyd.service

# Chat backend
systemctl status nixpi-chat.service
journalctl -u nixpi-chat.service -n 100

# Restart services
sudo systemctl restart nginx.service
sudo systemctl restart nixpi-chat.service
sudo systemctl restart nixpi-ttyd.service
```

## Access Network (WireGuard)

WireGuard is the supported remote-access layer for the default deployment path.

### Setup

NixPI enables a native WireGuard hub interface by default. You complete the operator path by:

1. reading the host public key with `wg show wg0 public-key`
2. generating a keypair for your laptop/phone/admin device
3. adding that device as a peer in NixOS
4. deploying and connecting outbound from the device to the host UDP port

### Adding Peers

Configure a standard WireGuard client on your laptop, phone, or admin workstation and point it at the NixPI host. Once connected, the device can reach the NixPI host through the private tunnel.

### Operations

```bash
systemctl status wireguard-wg0.service
journalctl -u wireguard-wg0.service -n 100
wg show wg0
sudo systemctl restart wireguard-wg0.service
```

## Related

- [Security Model](./security-model)
- [Quick Deploy](../operations/quick-deploy)
- [First Boot Setup](../operations/first-boot-setup)
