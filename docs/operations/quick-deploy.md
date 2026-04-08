# Quick Deploy

> Install NixPI onto a headless VPS with nixos-anywhere and operate it from the shell-first runtime

## Audience

Operators and maintainers deploying NixPI onto a headless x86_64 VPS.

## Security Note: WireGuard Is the Preferred Private Management Network

WireGuard remains the preferred private network path for NixPI hosts. SSH stays available for administration, while WireGuard provides the trusted management overlay for host-to-device access.

## Canonical Deployment Path

NixPI now has one deployment flow:

1. Put the VPS into rescue mode.
2. Run the `nixpi-deploy-ovh` wrapper.
3. Let first boot seed `/srv/nixpi` and `/etc/nixos/flake.nix`.
4. Keep operating from `/srv/nixpi`.

## 1. Enter rescue mode

Use the provider control panel to boot the VPS into rescue mode, then confirm you can SSH into the rescue environment as `root`.

For OVH-specific steps, follow [OVH Rescue Deploy](./ovh-rescue-deploy).

## 2. Run the install wrapper

From your local checkout:

```bash
nix run .#nixpi-deploy-ovh -- \
  --target-host root@SERVER_IP \
  --disk /dev/sdX
```

The install is destructive. On first boot the installed system seeds `/srv/nixpi`, initializes `/etc/nixos/flake.nix`, and keeps the standard `#nixos` rebuild target.

## 3. Validate first boot

Useful checks:

```bash
systemctl status sshd.service
systemctl status wireguard-wg0.service
systemctl status nixpi-update.timer
systemctl status nixpi-app-setup.service
wg show wg0
ip link show wg0
```

## 4. Operate from `/srv/nixpi`

Treat `/srv/nixpi` as the installed source of truth. Use it for edits, sync, and rebuilds.

```bash
cd /srv/nixpi
sudo nixpi-rebuild
```

To update the canonical checkout and rebuild in one command:

```bash
sudo nixpi-rebuild-pull
sudo nixpi-rebuild-pull main
```

Roll back if needed:

```bash
sudo nixos-rebuild switch --rollback
```

## 5. Validate the shell runtime

Smoke-check the core services on a running host:

```bash
systemctl status nixpi-app-setup.service
systemctl status sshd.service
command -v pi
su - <user> -c 'pi --help'
```

Expected result:

- the Pi runtime is seeded under `~/.pi`
- `pi` runs from SSH
- no second install path is required for routine operation

For repo-side validation during development:

```bash
nix --option substituters https://cache.nixos.org/ build .#checks.x86_64-linux.config --no-link
nix build .#checks.x86_64-linux.nixpi-firstboot --no-link -L
```
