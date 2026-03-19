# core/os/hosts/x86_64-installer.nix
# Minimal installer ISO configuration for Bloom OS.
# Boots to a console environment and exposes the bloom-install helper.
{ lib, pkgs, modulesPath, bloomApp, piAgent, nixpkgsSrc, bloomSrc, diskoSrc, ... }:

let
  bloomInstall = pkgs.runCommand "bloom-install" {} ''
    mkdir -p $out/bin
    cp ${../../scripts/bloom-install.sh} $out/bin/bloom-install
    chmod +x $out/bin/bloom-install
  '';
in
{
  imports = [
    "${modulesPath}/installer/cd-dvd/installation-cd-minimal.nix"
  ];

  nixpkgs.config.allowUnfree = true;
  hardware.enableAllFirmware = true;
  i18n.supportedLocales = [ "all" ];
  nix.settings.experimental-features = [ "nix-command" "flakes" ];

  environment.systemPackages = with pkgs; [
    bloomInstall
    bloomApp
    piAgent
    gitMinimal
    pciutils
    usbutils
    iw
    wirelesstools
    hdparm
  ];

  environment.etc."bloom/offline/nixpkgs".source = nixpkgsSrc;
  environment.etc."bloom/offline/disko".source   = diskoSrc;
  environment.etc."bloom/offline/bloom".source   = bloomSrc;

  isoImage.volumeID = lib.mkDefault "BLOOM_INSTALLER";
  image.fileName = lib.mkDefault "bloom-os-installer.iso";

  boot.kernelParams = [ "quiet" ];
  boot.kernelModules = [
    "rtw89_8852be" "rtw89_pci"
    "rtw88_8822be" "rtw88_8822ce" "rtw88_pci"
    "iwlwifi"
    "mt7921e"
    "ath11k_pci"
    "brcmfmac"
  ];

  environment.etc."issue".text = ''
    Welcome to the Bloom OS USB installer.

    1. Log in as root on the console.
    2. Run: bloom-install

    For help, visit: https://github.com/alexradunet/piBloom
  '';

  networking.hostName = lib.mkDefault "bloom-installer";
  networking.networkmanager.enable = true;
  networking.wireless.enable = lib.mkForce false;
}
