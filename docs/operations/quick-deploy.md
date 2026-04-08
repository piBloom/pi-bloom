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
3. Let `nixos-anywhere` install the final `ovh-vps` host configuration directly.
4. Validate the running host.
5. Use an operator-managed checkout only when you want a workspace for ongoing changes.

No first-boot repo clone or generated flake step is required.

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

The install is destructive and installs the final `ovh-vps` host configuration directly.

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

## 4. Use the standard rebuild path, or sync an operator checkout when needed

The installed host flake stays authoritative for convergence:

```bash
sudo nixpi-rebuild
```

A repo checkout such as `/srv/nixpi` is optional. If you keep the conventional `/srv/nixpi` checkout for operator workflows, `sudo nixpi-rebuild-pull [branch]` syncs the conventional `/srv/nixpi` checkout to a remote branch and rebuilds from it:

```bash
sudo nixpi-rebuild-pull [branch]
```

You can still rebuild from any explicit checkout path when you want a manual, path-specific workflow:

```bash
sudo nixos-rebuild switch --flake <checkout-path>#ovh-vps
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

- the Pi runtime is available from SSH
- the deployed host mode comes from NixOS config rather than user-home markers
- the installed `/etc/nixos` flake remains the source of truth for the running host
- shell behavior already matches the deployed NixOS configuration

For repo-side validation during development:

```bash
nix --option substituters https://cache.nixos.org/ build .#checks.x86_64-linux.config --no-link
nix build .#checks.x86_64-linux.nixpi-firstboot --no-link -L
```
