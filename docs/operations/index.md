# Operations

> Day-2 commands for deployed NixPI hosts

## Core workflows

```bash
# Canonical rebuild path
cd /srv/nixpi
sudo nixpi-rebuild

# Update checkout + rebuild
sudo nixpi-rebuild-pull

# Roll back
sudo nixos-rebuild switch --rollback
```

## Service inspection

```bash
systemctl status nixpi-app-setup.service
systemctl status sshd.service
systemctl status wireguard-wg0.service
systemctl status nixpi-update.timer
wg show wg0
```

## Related

- [OVH Rescue Deploy](./ovh-rescue-deploy)
- [Quick Deploy](./quick-deploy)
- [First Boot Setup](./first-boot-setup)
- [Live Testing](./live-testing)
