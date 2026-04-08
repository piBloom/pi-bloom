# OVH Rescue Deploy

> Fresh-install NixPI onto an OVH VPS from rescue mode using `nixos-anywhere`

## Audience

Operators provisioning a fresh OVH VPS that should boot directly into the NixPI
system defined by this repo.

## Before you start

This flow is **destructive**.

It repartitions and reformats the selected target disk, replacing whatever is
currently installed on the VPS.

Use it only for a fresh machine or a machine you intend to wipe.

## Requirements

- an OVH VPS reachable over SSH
- rescue mode access from the OVHcloud control panel
- a local machine with Nix and flakes enabled
- this repo available locally

## 1. Boot the VPS into rescue mode

In the OVHcloud control panel:

1. open the VPS
2. switch the machine to rescue mode
3. wait for the rescue SSH credentials
4. note the VPS IP address

OVH's current rescue-mode documentation:

- https://help.ovhcloud.com/csm/en-vps-rescue?id=kb_article_view&sysparm_article=KB0047656
- https://support.us.ovhcloud.com/hc/en-us/articles/360010553920-How-to-Recover-Your-VPS-in-Rescue-Mode

## 2. Verify the install disk explicitly

Connect to the rescue environment:

```bash
ssh root@SERVER_IP
```

List disks:

```bash
lsblk
```

Pick the install disk explicitly.

Common examples:

- `/dev/sda`
- `/dev/vda`
- `/dev/nvme0n1`

## 3. Run the install from this repo

From your local checkout of this repo:

```bash
nix run .#nixpi-deploy-ovh -- \
  --target-host root@SERVER_IP \
  --disk /dev/sda
```

Optional hostname override:

```bash
nix run .#nixpi-deploy-ovh -- \
  --target-host root@SERVER_IP \
  --disk /dev/sda \
  --hostname bloom-eu-1
```

If you want a single bootstrap user for first login, generate a SHA-512
bootstrap password hash locally and pass it to the wrapper.

For example, to create a bootstrap user named `human` with the password
`change123#@!`:

```bash
PASSWORD_HASH="$(python3 - <<'PY'
import crypt
print(crypt.crypt("change123#@!", crypt.mksalt(crypt.METHOD_SHA512)))
PY
)"

nix run .#nixpi-deploy-ovh -- \
  --target-host root@SERVER_IP \
  --disk /dev/sda \
  --bootstrap-user human \
  --bootstrap-password-hash "$PASSWORD_HASH"
```

What the wrapper does:

- uses the repo's `ovh-vps` configuration as the base system
- overrides the target disk explicitly for `disko`
- can create a single bootstrap user with `initialHashedPassword`
- runs `nixos-anywhere` against the OVH rescue host

## 4. Reconnect after the reinstall

After installation, the machine reboots into the installed NixOS system.

Because this is a reinstall, the SSH host key will change.

Remove the old host key and reconnect:

```bash
ssh-keygen -R SERVER_IP
ssh human@SERVER_IP
```

## 5. Switch to routine operations

After first login, the installed `/etc/nixos` flake is the authoritative host
configuration.

```bash
sudo nixpi-rebuild
```

If you keep the conventional `/srv/nixpi` operator checkout for repo-backed
changes, you can still sync and rebuild through it:

```bash
sudo nixpi-rebuild-pull [branch]
```

Rollback if needed:

```bash
sudo nixos-rebuild switch --rollback
```

## Notes

- This OVH path is for **fresh provisioning**.
- If the machine is already a NixOS-capable host and you only need to layer
  NixPI onto it, use the existing bootstrap workflow instead.
- The current first-class OVH path assumes a simple single-disk layout.
- The install connection can use the OVH rescue root password via
  `SSHPASS=...` and `--env-password`, but post-install login should use the
  bootstrap user you configured.

## Related

- [Install NixPI](../install)
- [Quick Deploy](./quick-deploy)
- [First Boot Setup](./first-boot-setup)
