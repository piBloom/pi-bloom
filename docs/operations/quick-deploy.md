# Quick Deploy

> Install a plain OVH base system with `nixos-anywhere`, then optionally bootstrap NixPI onto the host-owned `/etc/nixos` tree

## Audience

Operators and maintainers provisioning a standard NixOS host on a headless x86_64 VPS, with optional NixPI bootstrap afterward.

## Security Note: Public SSH Is CIDR-Restricted

NixPI uses plain SSH for remote administration, but only from explicitly allowlisted admin CIDRs. If the allowlist is wrong, recover through OVH console or rescue mode rather than a separate VPN overlay.

## Canonical Deployment Path

The recommended deployment flow is:

1. Put the VPS into rescue mode.
2. Run the `plain-host-deploy` wrapper.
3. Let `nixos-anywhere` install the `ovh-vps-base` system.
4. Reconnect to the installed machine after first boot.
5. Optionally bootstrap NixPI on the host.
6. Validate the running host and use `sudo nixpi-rebuild` for steady-state rebuilds.

The machine converges from `/etc/nixos#nixos`; repo checkouts are not part of the supported install path.

## 1. Enter rescue mode

Use the provider control panel to boot the VPS into rescue mode, then confirm you can SSH into the rescue environment as `root`.

For OVH-specific steps, follow [OVH Rescue Deploy](./ovh-rescue-deploy).

## 2. Run the install wrapper

From your local checkout:

```bash
nix run .#plain-host-deploy -- \
  --target-host root@SERVER_IP \
  --disk /dev/disk/by-id/PERSISTENT_TARGET_DISK_ID
```

The install is destructive and installs the plain `ovh-vps-base` provisioner preset only.

If the install fails with `No space left on device` during closure upload, do not assume the VPS disk is too small. On some OVH rescue hosts the disk order changes after `nixos-anywhere` kexecs into its temporary installer. Follow the staged troubleshooting flow in [OVH Rescue Deploy](./ovh-rescue-deploy) to inspect `/dev/disk/by-id` inside the installer and rerun the remaining phases with the correct installer-side disk ID.

If OVH KVM later stalls at SeaBIOS `Booting from Hard Disk...`, treat that as a boot-layout mismatch rather than a finished install. Reinstall from the updated repo so the current hybrid BIOS+EFI OVH disk layout is applied.

## 3. Optionally bootstrap NixPI after first boot

If the machine appears to reboot correctly but KVM still shows the OVH rescue environment, confirm the OVH control panel has been switched back from rescue mode to normal disk boot before debugging the installed system itself.

After the base system boots, reconnect to the machine and run:

```bash
nix run github:alexradunet/nixpi#nixpi-bootstrap-host -- \
  --primary-user alex \
  --ssh-allowed-cidr YOUR_ADMIN_IP/32 \
  --authorized-key-file /root/.ssh/authorized_keys \
  --timezone Europe/Bucharest \
  --keyboard us
```

Without `--hostname`, the installed host keeps the default `nixos` hostname.
The first rebuild stays in bootstrap mode so public SSH remains available from the configured admin CIDRs while you validate the host and complete the operator handoff.

If `/etc/nixos/flake.nix` already exists, follow the printed manual integration instructions and rebuild `/etc/nixos#nixos` explicitly.

## 4. Use the standard rebuild path

The installed `/etc/nixos#nixos` host flake stays authoritative for convergence:

```bash
sudo nixpi-rebuild
```

Manual recovery or existing-flake integration also rebuilds through the same host-owned root:

```bash
sudo nixos-rebuild switch --flake /etc/nixos#nixos --impure
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
systemctl status nixpi-update.timer
command -v pi
su - <user> -c 'pi --help'
sshd -T | grep -E 'passwordauthentication|permitrootlogin|allowtcpforwarding|allowagentforwarding'
sudo nft list ruleset | grep 'dport 22'
```

Expected result:

- the Pi runtime is available from SSH
- the deployed host mode comes from NixOS config rather than user-home markers
- the installed `/etc/nixos` flake remains the source of truth for the running host
- shell behavior already matches the deployed NixOS configuration
- SSH is key-only and port `22` is scoped to the expected admin CIDRs

For repo-side validation during development:

```bash
nix --option substituters https://cache.nixos.org/ build .#checks.x86_64-linux.config --no-link
nix build .#checks.x86_64-linux.nixpi-firstboot --no-link -L
```
