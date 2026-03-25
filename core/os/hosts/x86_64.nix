# core/os/hosts/x86_64.nix
# Canonical NixPI desktop profile used for dev builds and the installed system shape.
{ lib, config, ... }:

{
  imports = [
    ../modules
  ];

  system.stateVersion = "25.05";

  boot.loader.systemd-boot.enable = true;
  boot.loader.efi.canTouchEfiVariables = true;
  boot.kernelParams = [ "console=tty0" "console=ttyS0,115200" ];
  systemd.services."serial-getty@ttyS0".enable = lib.mkDefault true;
  nixpi.security.ssh.passwordAuthentication = lib.mkDefault true;
  nixpi.bootstrap.keepSshAfterSetup = lib.mkDefault true;
  nixpi.primaryUser = lib.mkDefault "pi";
  nixpi.netbird.apiTokenFile = lib.mkDefault "${config.nixpi.stateDir}/netbird-api-token";

  time.timeZone = config.nixpi.timezone;
  i18n.defaultLocale = "en_US.UTF-8";
  networking.networkmanager.enable = true;
  services.xserver.xkb = { layout = config.nixpi.keyboard; variant = ""; };
  console.keyMap = config.nixpi.keyboard;
  networking.hostName = lib.mkDefault "nixpi";
  fileSystems."/" = lib.mkDefault {
    device = "/dev/disk/by-label/nixos";
    fsType = "ext4";
  };
  fileSystems."/boot" = lib.mkDefault {
    device = "/dev/disk/by-label/boot";
    fsType = "vfat";
  };
}
