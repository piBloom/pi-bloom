# OVH Rescue Deploy

> Fresh-install a plain OVH base system from rescue mode, then optionally bootstrap NixPI onto the machine

## Audience

Operators provisioning a fresh OVH VPS that should first become a standard NixOS host, with optional NixPI bootstrap afterward.

## Before you start

This flow is **destructive**.

It repartitions and reformats the selected target disk, replacing whatever is currently installed on the VPS.

Use it only for a fresh machine or a machine you intend to wipe.

## Requirements

- an OVH VPS reachable over SSH
- rescue mode access from the OVHcloud control panel
- a local machine with Nix and flakes enabled
- this repo available locally
- a plan for how you will reconnect to the installed base system after the reboot

## 1. Boot the VPS into rescue mode

In the OVHcloud control panel:

1. open the VPS
2. switch the machine to rescue mode
3. wait for the rescue SSH credentials
4. note the VPS IP address

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

For OVH and similar virtualized environments, also inspect the persistent disk IDs before you start:

```bash
ls -l /dev/disk/by-id
fdisk -l
```

This matters because the Linux device names can change after `nixos-anywhere` kexecs into its temporary NixOS installer.

### Example from a successful OVH install

In the OVH rescue system we observed:

- the rescue disk was the small `2.9G` disk
- the target VPS disk was the `200G` disk
- before kexec, the `200G` target disk appeared as `/dev/sda`

After kexec into the temporary NixOS installer, the disks were renumbered:

- the small `2.9G` disk appeared as `/dev/sda`
- the real `200G` target disk appeared as `/dev/sdb`

Because of that renumbering, the final successful install used the installer's persistent path for the `200G` disk:

```bash
/dev/disk/by-id/scsi-0QEMU_QEMU_HARDDISK_drive-scsi0-0-0-1
```

## 3. Install the plain base system from this repo

From your local checkout of this repo:

```bash
nix run .#plain-host-deploy -- \
  --target-host root@SERVER_IP \
  --disk /dev/disk/by-id/PERSISTENT_TARGET_DISK_ID
```

Optional hostname override:

```bash
nix run .#plain-host-deploy -- \
  --target-host root@SERVER_IP \
  --disk /dev/disk/by-id/PERSISTENT_TARGET_DISK_ID \
  --hostname my-host
```

If you do not pass `--hostname`, the installed base system keeps the default `nixos` hostname.

What the wrapper does:

- uses the repo's `ovh-vps-base` provisioner preset as the base system
- overrides the target disk explicitly for `disko`
- runs `nixos-anywhere` against the OVH rescue host
- leaves NixPI bootstrapping for after the machine reboots into the installed system

`plain-host-deploy` installs the plain base system only. After the machine reboots, run `nixpi-bootstrap-host` on the machine if you want the NixPI layer.

## 4. Troubleshooting: staged kexec debug when the disk changes after kexec

If the install fails with `No space left on device` even though the VPS disk is large enough, stop and verify which disk the temporary NixOS installer is actually using.

This usually means the target disk was correct in the rescue system but mapped to a different device after kexec.

### 4.1 Boot only into the installer

Use staged mode to run only the `kexec` phase:

```bash
nix run .#plain-host-deploy -- \
  --target-host root@SERVER_IP \
  --disk /dev/disk/by-id/PERSISTENT_TARGET_DISK_ID \
  --phases kexec
```

### 4.2 Important: rescue passwords do not carry over into the kexec installer

The OVH rescue `root` password belongs only to the rescue OS. After kexec, you are in a different temporary NixOS installer, so that password no longer works.

If you want to SSH into the installer for debugging, add your local SSH public key to the rescue shell **before** running the `kexec` phase:

```bash
cat ~/.ssh/id_ed25519.pub
```

Then, inside the OVH rescue shell:

```bash
mkdir -p /root/.ssh && chmod 700 /root/.ssh && printf '%s\n' 'PASTE_YOUR_PUBLIC_KEY_HERE' >> /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys
```

The kexec helper copies `root`'s `authorized_keys`, so you can then SSH into the temporary installer with your key.

### 4.3 Inspect the installer's disk mapping

Once the box comes back after `--phases kexec`, inspect the disks inside the temporary NixOS installer:

```bash
ssh root@SERVER_IP 'lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINTS; echo "---"; ls -l /dev/disk/by-id'
```

Identify which `/dev/disk/by-id/...` path points to the real target disk in the installer environment.

### 4.4 Resume the remaining phases with the installer's disk ID

After identifying the correct disk path inside the temporary installer, rerun the wrapper with the remaining phases only:

```bash
nix run .#plain-host-deploy -- \
  --target-host root@SERVER_IP \
  --disk /dev/disk/by-id/INSTALLER_TARGET_DISK_ID \
  --phases disko,install,reboot
```

This was the successful recovery path for the live OVH run that initially failed with a misleading `No space left on device` error.

### 4.5 If OVH KVM hangs at `Booting from Hard Disk...`

If the install reports success but the OVH KVM stays at a SeaBIOS screen that ends with:

```text
Booting from Hard Disk...
```

then the machine did not reach the installed NixOS userspace. In our live OVH run, this happened because the earlier disk layout only created an EFI system partition, while the VPS firmware actually booted through SeaBIOS.

The current `ovh-vps-base` provisioner preset includes both:

- a BIOS boot partition (`EF02`) for GRUB on SeaBIOS
- an EFI system partition (`EF00`) for removable EFI boot

If your failed install was created **before** that hybrid BIOS+EFI fix, put the machine back into rescue mode and reinstall from the updated repo. A successful `nixos-anywhere` run is not enough if the installed disk layout does not match the provider's actual firmware mode.

## 5. Reconnect and bootstrap NixPI

After installation, the machine reboots into the installed base NixOS system.

Because this is a reinstall, the SSH host key can change.

Before judging the result, make sure the OVH control panel is switched back from **rescue mode** to the normal disk boot mode. If OVH is still configured to boot rescue mode, the machine can reboot successfully yet still land back in the rescue environment instead of the installed system.

Remove the old host key if needed and reconnect:

```bash
ssh-keygen -R SERVER_IP
ssh root@SERVER_IP
```

Then bootstrap NixPI on the machine:

```bash
nix run github:alexradunet/nixpi#nixpi-bootstrap-host -- \
  --primary-user alex \
  --authorized-key-file /root/.ssh/authorized_keys \
  --timezone Europe/Bucharest \
  --keyboard us
```

If `/etc/nixos/flake.nix` already exists, follow the printed manual integration steps and rebuild `/etc/nixos#nixos` explicitly.
The generated host remains in bootstrap mode after the first rebuild so SSH stays reachable while you validate the machine and switch normal access to the primary user.

## 6. Switch to routine operations

After bootstrap, the installed `/etc/nixos` flake is the authoritative host configuration.

```bash
sudo nixpi-rebuild
```

Rollback if needed:

```bash
sudo nixos-rebuild switch --rollback
```

## Notes

- This OVH path is for **fresh provisioning**.
- If the machine is already an installed NixOS host and you only need to layer NixPI onto it, skip rescue deploy and run `nixpi-bootstrap-host` directly on that machine.
- The current first-class OVH path assumes a simple single-disk layout.
- NixPI is a layer on a host-owned `/etc/nixos`, not the machine root.

## Related

- [Install Plain Host](../install-plain-host)
- [Bootstrap NixPI](../install)
- [Quick Deploy](./quick-deploy)
- [First Boot Setup](./first-boot-setup)
