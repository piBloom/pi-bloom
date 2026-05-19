{ ... }:

{
  # Extra options used only when building the initial Proxmox qcow image.
  # The runtime system config is still hosts/edge/configuration.nix.
  virtualisation.diskSize = 16 * 1024;

  # The generated qcow image is imported into Proxmox as a VirtIO disk.
  boot.loader.grub.device = "/dev/vda";
}
