{ lib, pkgs, modulesPath, ... }:

let
  nixpiSource = lib.cleanSource ../../..;
in
{
  imports = [
    "${modulesPath}/installer/cd-dvd/installation-cd-graphical-calamares-gnome.nix"
  ];

  nixpkgs.overlays = [
    (import ../overlays/installer-calamares.nix { inherit nixpiSource; })
  ];

  system.stateVersion = "25.05";
  nixpkgs.hostPlatform = "x86_64-linux";
  nixpkgs.config.allowUnfree = true;

  isoImage = {
    appendToMenuLabel = "NixPI Installer";
    edition = "nixpi";
    volumeID = "NIXPI_INSTALL";
  };

  image.fileName = "nixpi-installer-${pkgs.stdenv.hostPlatform.system}.iso";

  networking.hostName = "nixpi-installer";
  networking.networkmanager.enable = true;
  time.timeZone = "UTC";
  i18n.defaultLocale = "en_US.UTF-8";

  environment.systemPackages = with pkgs; [
    git
    just
    curl
  ];
}
