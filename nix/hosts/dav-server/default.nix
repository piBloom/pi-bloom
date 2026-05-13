{ lib, ... }:
{
  imports = [
    ./hardware.nix
    ../../modules/dav-server.nix
  ];

  # VM 121 is deployed from the generated qcow2 image on a single legacy-BIOS
  # VirtIO disk. Keep the normal rebuild target aligned with that installed
  # shape so remote `nixos-rebuild switch` remains reproducible.
  boot.loader.systemd-boot.enable = lib.mkForce false;
  boot.loader.efi.canTouchEfiVariables = lib.mkForce false;
  boot.loader.grub = {
    enable = true;
    device = "/dev/vda";
  };
  boot.growPartition = true;
  boot.kernelParams = [ "console=ttyS0" ];
  boot.initrd.availableKernelModules = [
    "virtio_pci"
    "virtio_blk"
    "virtio_scsi"
    "sd_mod"
    "sr_mod"
  ];

  fileSystems."/" = {
    device = lib.mkForce "/dev/disk/by-label/nixos";
    fsType = lib.mkForce "ext4";
    options = lib.mkForce [
      "x-systemd.growfs"
      "x-initrd.mount"
    ];
  };

  system.stateVersion = "26.05";
}
