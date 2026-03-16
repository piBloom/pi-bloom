# core/os/hosts/x86_64.nix
{ pkgs, lib, ... }:

{
  imports = [
    ../modules/bloom-app.nix
    ../modules/bloom-matrix.nix
    ../modules/bloom-network.nix
    ../modules/bloom-shell.nix
    ../modules/bloom-update.nix
  ];

  system.stateVersion = "25.05";
  nixpkgs.hostPlatform = "x86_64-linux";

  boot.loader.systemd-boot.enable = true;
  boot.loader.efi.canTouchEfiVariables = true;

  nixpkgs.config.allowUnfree = true;

  time.timeZone   = "UTC";
  i18n.defaultLocale = "en_US.UTF-8";
}
