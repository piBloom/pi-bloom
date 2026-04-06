# Operations

> Deploy, operate, and maintain NixPI as a headless VPS service

## What's In This Section

This section covers the headless operator workflow for NixPI:

- bootstrapping a fresh VPS
- validating first boot and remote service readiness
- running updates and rollbacks from `/srv/nixpi`
- day-to-day service inspection and smoke testing

## Operations Topics

| Topic | Description |
|-------|-------------|
| [Quick Deploy](./quick-deploy) | Bootstrap a VPS, enroll NetBird, and open the remote app |
| [First Boot Setup](./first-boot-setup) | Validate the public app surface plus the internal backend probe |
| [Live Testing](./live-testing) | Release-time validation for the headless VPS operator path |

## Quick Reference

### Common Commands

```bash
# Fresh VPS bootstrap
nix run github:alexradunet/nixpi#nixpi-bootstrap-vps

# Rebuild from the canonical installed checkout
cd /srv/nixpi
git fetch origin
git rebase origin/main
sudo nixos-rebuild switch --flake /srv/nixpi#nixpi
sudo nixos-rebuild switch --rollback

# Service inspection
systemctl status nixpi-chat.service
systemctl status nixpi-ttyd.service
systemctl status nginx.service
systemctl status netbird.service

# Validation
nix --option substituters https://cache.nixos.org/ build .#checks.x86_64-linux.config --no-link
nix build .#checks.x86_64-linux.nixpi-vps-bootstrap --no-link -L
```

## Related

- [Install NixPI](../install) - public install path
- [Architecture](../architecture/) - system design
- [Codebase](../codebase/) - implementation details
- [Reference](../reference/) - deep technical docs
