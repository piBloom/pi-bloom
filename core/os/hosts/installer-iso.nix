{ lib, pkgs, modulesPath, installerHelper, self, ... }:

{
  imports = [
    "${modulesPath}/installer/cd-dvd/installation-cd-minimal.nix"
  ];

  system.stateVersion = "25.05";
  nixpkgs.hostPlatform = "x86_64-linux";
  nixpkgs.config.allowUnfree = true;

  isoImage = {
    appendToMenuLabel = "NixPI Installer";
    edition = "nixpi";
    volumeID = "NIXPI_INSTALL";
    forceTextMode = true;
    grubTheme = null;
  };

  image.fileName = "nixpi-installer-${pkgs.stdenv.hostPlatform.system}.iso";

  boot.kernelParams = [ "console=tty0" "console=ttyS0,115200n8" ];

  networking.hostName = "nixpi-installer";
  networking.networkmanager.enable = true;
  time.timeZone = "UTC";
  i18n.defaultLocale = "en_US.UTF-8";
  services.getty.autologinUser = lib.mkForce "root";
  systemd.services."serial-getty@ttyS0".enable = true;
  systemd.services."serial-getty@ttyS0".serviceConfig.ExecStart = [
    ""
    "${lib.getExe' pkgs.util-linux "agetty"} --login-program ${pkgs.shadow}/bin/login --autologin root --keep-baud ttyS0 115200,38400,9600 vt220"
  ];

  environment.loginShellInit = lib.mkAfter ''
    if [ "$(id -u)" -eq 0 ] \
      && [ -t 0 ] \
      && [ -t 1 ] \
      && [ -z "''${NIXPI_INSTALLER_AUTOSTARTED:-}" ] \
      && [ ! -e /run/nixpi-installer-autostart-done ]
    then
      case "$(tty)" in
        /dev/tty1|/dev/ttyS0)
          export NIXPI_INSTALLER_AUTOSTARTED=1
          touch /run/nixpi-installer-autostart-done
          nixpi-installer
          ;;
      esac
    fi
  '';

  environment.systemPackages = [
    installerHelper
  ];

  system.extraDependencies = [
    self.nixosConfigurations.desktop.config.system.build.toplevel
  ];
}
