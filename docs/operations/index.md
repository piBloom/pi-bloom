# Operations

> Day-2 commands for deployed NixPI hosts

The installed `/etc/nixos` flake is authoritative for the running host. Keep an operator checkout such as `/srv/nixpi` only if you want the conventional repo-sync workflow.

## Core workflows

```bash
# Rebuild the installed host flake
sudo nixpi-rebuild

# Optional: sync the conventional /srv/nixpi checkout, then rebuild
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
