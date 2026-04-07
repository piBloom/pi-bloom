# Manual QEMU Lab

## Paths

- lab root: `.omx/qemu-lab/`
- installer ISO: `.omx/qemu-lab/nixos-stable-installer.iso`
- installer scratch disk: `.omx/qemu-lab/disks/installer-scratch.qcow2`
- preinstalled stable disk: `.omx/qemu-lab/disks/preinstalled-stable.qcow2`
- serial logs: `.omx/qemu-lab/logs/`

## Installer flow

1. Put a stable NixOS installer ISO at `.omx/qemu-lab/nixos-stable-installer.iso`.
2. Run `tools/qemu/run-installer.sh`.
3. In the guest, install NixOS manually onto `.omx/qemu-lab/disks/installer-scratch.qcow2`.
4. Reboot, log in, and validate the base install.

## Preinstalled-stable flow

1. Run `tools/qemu/prepare-preinstalled-stable.sh` to create the reusable target disk.
2. Boot the installer flow with `tools/qemu/run-installer.sh` and install stable NixOS onto `.omx/qemu-lab/disks/installer-scratch.qcow2`.
3. After shutdown, clone the installed scratch disk into the reusable image:

```bash
qemu-img convert -f qcow2 -O qcow2 \
  .omx/qemu-lab/disks/installer-scratch.qcow2 \
  .omx/qemu-lab/disks/preinstalled-stable.qcow2
```

4. Boot the reusable image with `tools/qemu/run-preinstalled-stable.sh`.

## Shared repo mount

The repo is exposed to the guest as a 9p share with mount tag `nixpi-repo`.
Mount it manually in the guest when needed.
