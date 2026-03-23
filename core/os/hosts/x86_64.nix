# core/os/hosts/x86_64.nix
# Canonical NixPI desktop profile used for dev builds and the installed system shape.
{ lib, ... }:

{
  imports = [
    ../modules/options.nix
    ../modules/setup.nix
    ../modules/network.nix
    ../modules/update.nix
    ../modules/runtime.nix
    ../modules/collab.nix
    ../modules/tooling.nix
    ../modules/shell.nix
    ../modules/firstboot.nix
    ../modules/desktop-openbox.nix
  ];

  system.stateVersion = "25.05";

  boot.loader.systemd-boot.enable = true;
  boot.loader.efi.canTouchEfiVariables = true;
  boot.kernelParams = [ "console=tty0" "console=ttyS0,115200" ];
  systemd.services."serial-getty@ttyS0".enable = true;
  nixpi.security.ssh.passwordAuthentication = lib.mkDefault true;
  nixpi.bootstrap.keepSshAfterSetup = lib.mkDefault true;
  nixpi.primaryUser = lib.mkDefault "pi";

  time.timeZone = "UTC";
  i18n.defaultLocale = "en_US.UTF-8";
  networking.networkmanager.enable = true;
  services.xserver.xkb = { layout = "us"; variant = ""; };
  console.keyMap = "us";
  networking.hostName = lib.mkDefault "nixpi";
  fileSystems."/" = lib.mkDefault {
    device = "/dev/vda";
    fsType = "ext4";
  };
  fileSystems."/boot" = lib.mkDefault {
    device = "/dev/vda1";
    fsType = "vfat";
  };
}
