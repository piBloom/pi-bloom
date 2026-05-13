{ vm, ... }:
{
  imports = [
    ../../modules/dav-server.nix
  ];

  image = {
    baseName = "nixos-${vm.hostname}";
    format = "qcow2";
    # Use legacy BIOS for the imported Proxmox qcow2 to avoid needing an EFI
    # vars disk during initial VM creation. The installed host profile still
    # supports OVMF/systemd-boot when installing via disko instead.
    efiSupport = false;
  };

  # Keep the generated qcow2 small; resize the Proxmox disk to vm.diskGiB after
  # import. The image grows its root partition on first boot.
  virtualisation.diskSize = 8192;

  services.qemuGuest.enable = true;
  services.fstrim.enable = true;

  boot.growPartition = true;
  boot.kernelParams = [ "console=ttyS0" ];
  boot.initrd.availableKernelModules = [
    "virtio_pci"
    "virtio_blk"
    "virtio_scsi"
    "sd_mod"
    "sr_mod"
  ];

  system.stateVersion = "26.05";
}
