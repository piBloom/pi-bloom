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

For OVH and similar virtualized environments, also inspect the persistent disk
IDs before you start:

```bash
ls -l /dev/disk/by-id
fdisk -l
```

This matters because the Linux device names can change after
`nixos-anywhere` kexecs into its temporary NixOS installer.

### Example from a successful OVH install

In the OVH rescue system we observed:

- the rescue disk was the small `2.9G` disk
- the target VPS disk was the `200G` disk
- before kexec, the `200G` target disk appeared as `/dev/sda`

After kexec into the temporary NixOS installer, the disks were renumbered:

- the small `2.9G` disk appeared as `/dev/sda`
- the real `200G` target disk appeared as `/dev/sdb`

Because of that renumbering, the final successful install used the installer
environment's persistent path for the `200G` disk:

```bash
/dev/disk/by-id/scsi-0QEMU_QEMU_HARDDISK_drive-scsi0-0-0-1
```

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

### Recommended direct install path

If you already know the correct target disk path for the current environment,
run the full install directly:

```bash
nix run .#nixpi-deploy-ovh -- \
  --target-host root@SERVER_IP \
  --disk /dev/disk/by-id/PERSISTENT_TARGET_DISK_ID
```

If you want a bootstrap user named `alex` with a known password hash:

```bash
PASSWORD_HASH="$(python3 - <<'PY'
import crypt
print(crypt.crypt("changeMe123#@!", crypt.mksalt(crypt.METHOD_SHA512)))
PY
)"

nix run .#nixpi-deploy-ovh -- \
  --target-host root@SERVER_IP \
  --disk /dev/disk/by-id/PERSISTENT_TARGET_DISK_ID \
  --bootstrap-user alex \
  --bootstrap-password-hash "$PASSWORD_HASH"
```

## 4. Troubleshooting: staged kexec debug when the disk changes after kexec

If the install fails with `No space left on device` even though the VPS disk is
large enough, stop and verify which disk the temporary NixOS installer is
actually using.

This usually means the target disk was correct in the rescue system but mapped
to a different device after kexec.

### 4.1 Boot only into the installer

Use the wrapper's staged mode to run only the `kexec` phase:

```bash
nix run .#nixpi-deploy-ovh -- \
  --target-host root@SERVER_IP \
  --disk /dev/disk/by-id/PERSISTENT_TARGET_DISK_ID \
  --phases kexec
```

### 4.2 Important: rescue passwords do not carry over into the kexec installer

The OVH rescue `root` password belongs only to the rescue OS. After kexec, you
are in a different temporary NixOS installer, so that password no longer works.

If you want to SSH into the installer for debugging, add your local SSH public
key to the rescue shell **before** running the `kexec` phase:

```bash
cat ~/.ssh/id_ed25519.pub
```

Then, inside the OVH rescue shell:

```bash
mkdir -p /root/.ssh && chmod 700 /root/.ssh && printf '%s\n' 'PASTE_YOUR_PUBLIC_KEY_HERE' >> /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys
```

The kexec helper copies `root`'s `authorized_keys`, so you can then SSH into
the temporary installer with your key.

### 4.3 Inspect the installer's disk mapping

Once the box comes back after `--phases kexec`, inspect the disks inside the
temporary NixOS installer:

```bash
ssh root@SERVER_IP 'lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINTS; echo "---"; ls -l /dev/disk/by-id'
```

Identify which `/dev/disk/by-id/...` path points to the real target disk in the
installer environment.

### 4.4 Resume the remaining phases with the installer's disk ID

After identifying the correct disk path inside the temporary installer, rerun
the wrapper with the remaining phases only:

```bash
PASSWORD_HASH="$(python3 - <<'PY'
import crypt
print(crypt.crypt("changeMe123#@!", crypt.mksalt(crypt.METHOD_SHA512)))
PY
)"

nix run .#nixpi-deploy-ovh -- \
  --target-host root@SERVER_IP \
  --disk /dev/disk/by-id/INSTALLER_TARGET_DISK_ID \
  --bootstrap-user alex \
  --bootstrap-password-hash "$PASSWORD_HASH" \
  --phases disko,install,reboot
```

This was the successful recovery path for the live OVH run that initially
failed with a misleading `No space left on device` error.
## 5. Reconnect after the reinstall

After installation, the machine reboots into the installed NixOS system.

Because this is a reinstall, the SSH host key will change.

Remove the old host key and reconnect:

```bash
ssh-keygen -R SERVER_IP
ssh human@SERVER_IP
```

## 6. Switch to routine operations

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
