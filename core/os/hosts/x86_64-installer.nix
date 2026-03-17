# core/os/hosts/x86_64-installer.nix
# Graphical installer ISO configuration for Bloom OS
# Uses Calamares GUI installer with LXQt desktop
{ pkgs, lib, modulesPath, ... }:

let
  # Wrap the conversion script for inclusion in the ISO
  bloom-convert = pkgs.writeShellScriptBin "bloom-convert" (builtins.readFile ../../scripts/bloom-convert.sh);

  # Desktop file for the installer
  bloom-convert-desktop = pkgs.makeDesktopItem {
    name = "bloom-convert";
    desktopName = "Convert to Bloom OS";
    comment = "Convert NixOS installation to Bloom OS";
    exec = "bloom-convert";
    icon = "system-software-install";
    terminal = true;
    categories = [ "System" "Settings" ];
  };

  # Desktop file for Calamares installer
  calamares-desktop = pkgs.makeDesktopItem {
    name = "calamares";
    desktopName = "Install NixOS";
    comment = "Install NixOS to disk";
    exec = "sudo -E calamares";
    icon = "calamares";
    terminal = false;
    categories = [ "System" ];
  };
in
{
  imports = [
    # Standard NixOS Calamares installer with GNOME (includes Calamares + desktop)
    # Note: We use GNOME-based Calamares module for full Calamares support,
    # but we'll override with LXQt desktop below
    "${modulesPath}/installer/cd-dvd/installation-cd-graphical-calamares-gnome.nix"

    # LXQt desktop configuration
    ../modules/bloom-desktop.nix
  ];

  # Override: Use LXQt instead of GNOME
  services.desktopManager.gnome.enable = lib.mkForce false;
  services.displayManager.gdm.enable = lib.mkForce false;

  # Ensure we have LightDM for LXQt
  services.xserver.displayManager.lightdm.enable = lib.mkDefault true;

  # ISO-specific settings
  isoImage.volumeID = lib.mkDefault "BLOOM_INSTALLER";
  image.fileName = lib.mkDefault "bloom-os-installer.iso";

  # Boot configuration for live environment
  boot.kernelParams = [
    "copytoram"  # Copy ISO to RAM for faster operation
    "quiet"
    "splash"
  ];

  # Add conversion tools and desktop files
  environment.systemPackages = [
    bloom-convert
    bloom-convert-desktop
    calamares-desktop
  ];

  # Create desktop shortcuts on the live desktop
  system.activationScripts.bloom-installer-desktop = lib.stringAfter [ "users" ] ''
    mkdir -p /home/nixos/Desktop
    
    # Calamares installer shortcut
    cp ${calamares-desktop}/share/applications/calamares.desktop /home/nixos/Desktop/"Install NixOS.desktop"
    chmod +x /home/nixos/Desktop/"Install NixOS.desktop"
    
    # Bloom conversion shortcut (only shown after install)
    # This will be available in the applications menu
    
    chown -R nixos:users /home/nixos/Desktop
  '';

  # Welcome message for the live environment
  environment.etc."issue".text = ''
    Welcome to Bloom OS Installer!

    1. Double-click "Install NixOS" to install the base system
    2. Reboot into the installed system
    3. Run "Convert to Bloom OS" to switch to Bloom

    For help, visit: https://github.com/alexradunet/piBloom

  '';

  # Documentation link in browser favorites
  programs.firefox.preferences = {
    "browser.startup.homepage" = "https://github.com/alexradunet/piBloom";
  };

  networking.hostName = lib.mkDefault "bloom-installer";

  # Disable some NixOS installer defaults we don't need
  services.libinput.enable = true;  # Touchpad support

  # Ensure NetworkManager is enabled for WiFi GUI
  networking.networkmanager.enable = true;
  networking.wireless.enable = lib.mkForce false;  # Disable wpa_supplicant, use NM
}
