# core/os/hosts/ovh-vps.nix
# OVH-oriented VPS profile for destructive nixos-anywhere installs that land
# directly on the final host configuration.
{ lib, modulesPath, ... }:

{
  imports = [
    ./vps.nix
    (modulesPath + "/profiles/qemu-guest.nix")
  ];

  networking.hostName = lib.mkOverride 900 "ovh-vps";

  boot.loader = {
    systemd-boot.enable = lib.mkForce false;
    efi.canTouchEfiVariables = lib.mkForce false;
    grub = {
      enable = true;
      efiSupport = true;
      efiInstallAsRemovable = true;
      device = "nodev";
    };
  };

  services.qemuGuest.enable = lib.mkDefault true;
}
