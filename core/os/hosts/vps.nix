# core/os/hosts/vps.nix
# Canonical NixPI headless VPS profile used for the default installed system shape.
{ lib, config, ... }:

let
  moduleSets = import ../modules/module-sets.nix;
in
{
  imports = moduleSets.nixpi;

  system.stateVersion = "25.05";

  boot = {
    loader = {
      systemd-boot.enable = true;
      efi.canTouchEfiVariables = true;
    };
    # Use tty0 so the active local VT keeps visible boot/login output on
    # monitor-attached x86_64 hosts, while tty1 still provides the recovery getty.
    kernelParams = [
      "console=tty0"
      "console=ttyS0,115200"
    ];
  };
  systemd.services."getty@tty1".enable = lib.mkDefault true;
  systemd.services."serial-getty@ttyS0".enable = lib.mkDefault true;

  nixpi = {
    bootstrap.enable = lib.mkDefault true;
    security.ssh.passwordAuthentication = lib.mkDefault false;
  };

  networking.hostName = lib.mkDefault "nixpi";
  networking.networkmanager.enable = true;
  time.timeZone = config.nixpi.timezone;
  i18n.defaultLocale = "en_US.UTF-8";
  console.keyMap = config.nixpi.keyboard;
  # Include redistributable firmware for reliable guest/hardware bring-up.
  hardware.enableRedistributableFirmware = lib.mkDefault true;

  fileSystems."/" = lib.mkDefault {
    device = "/dev/disk/by-label/nixos";
    fsType = "ext4";
  };

  fileSystems."/boot" = lib.mkDefault {
    device = "/dev/disk/by-label/boot";
    fsType = "vfat";
  };
}
