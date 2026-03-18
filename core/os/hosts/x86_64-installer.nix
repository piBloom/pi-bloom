# core/os/hosts/x86_64-installer.nix
# Graphical installer ISO configuration for Bloom OS.
# Uses Calamares GUI installer with GNOME desktop (auto-starts Calamares via GDM).
# Custom calamares-nixos-extensions override provides Bloom-specific wizard pages.
{ lib, pkgs, modulesPath, bloomApp, piAgent, nixpkgsSrc, bloomSrc, ... }:

{
  imports = [
    # Calamares + GNOME installer base — handles GDM autologin, Calamares
    # autostart, polkit agent, and display manager out of the box.
    "${modulesPath}/installer/cd-dvd/installation-cd-graphical-calamares-gnome.nix"
  ];

  # Replace upstream calamares-nixos-extensions with our custom Bloom version.
  # Use prev.callPackage so package.nix receives the pre-overlay pkgs and the
  # pre-overlay calamares-nixos-extensions — prevents infinite recursion.
  nixpkgs.overlays = [
    (final: prev: {
      calamares-nixos-extensions = prev.callPackage ../../calamares/package.nix {
        upstreamCalamares = prev.calamares-nixos-extensions;
      };
    })
  ];

  # Support all locales (Calamares needs this for the locale selection step)
  i18n.supportedLocales = [ "all" ];

  # Extra tools available in the live environment.
  # bloomApp and piAgent are included here so their store paths are already in
  # the ISO squashfs.  The installer's `nix build` step (which evaluates the
  # same flake.lock pinned at ISO build time) then reuses these paths from the
  # host store instead of re-fetching and rebuilding, which would exhaust the
  # live ISO's tmpfs.
  environment.systemPackages = with pkgs; [
    gparted
    bloomApp
    piAgent
  ];

  # Offline installation: embed flake input source trees in the squashfs.
  # During installation, `nix build --no-update-lock-file` resolves inputs via
  # the bundled flake.lock.  Nix looks up each narHash → store path; if the
  # path exists (because it's in the squashfs), the download is skipped.
  # This makes installation work with no internet connection.
  environment.etc."bloom/offline/nixpkgs".source = nixpkgsSrc;
  environment.etc."bloom/offline/bloom".source   = bloomSrc;

  # ISO-specific settings
  isoImage.volumeID  = lib.mkDefault "BLOOM_INSTALLER";
  image.fileName     = lib.mkDefault "bloom-os-installer.iso";

  boot.kernelParams = [
    # copytoram omitted: loading the full squashfs (which includes
    # nixpkgs and bloom source trees for offline installation) into RAM
    # would exhaust memory on low-RAM machines and is unnecessary for an
    # installer that reads from USB only during initial boot.
    "quiet"
    "splash"
  ];

  environment.etc."issue".text = ''
    Welcome to Bloom OS Installer!

    The installer will launch automatically on the desktop.

    For help, visit: https://github.com/alexradunet/piBloom

  '';

  programs.firefox.preferences = {
    "browser.startup.homepage" = "https://github.com/alexradunet/piBloom";
  };

  networking.hostName          = lib.mkDefault "bloom-installer";
  networking.networkmanager.enable = true;
  networking.wireless.enable   = lib.mkForce false;
  services.libinput.enable     = true;
}
