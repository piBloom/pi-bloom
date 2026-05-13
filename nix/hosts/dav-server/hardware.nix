{
  # Generic Proxmox/q35/VirtIO hardware profile. Disk layout and file systems
  # are declared in ./disko.nix.
  boot.initrd.availableKernelModules = [
    "ata_piix"
    "uhci_hcd"
    "virtio_pci"
    "virtio_scsi"
    "sd_mod"
    "sr_mod"
  ];

  swapDevices = [ ];
}
