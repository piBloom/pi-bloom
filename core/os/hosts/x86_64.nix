# core/os/hosts/x86_64.nix — temporary evaluation stub; replaced in Task 10
{ ... }: {
  system.stateVersion = "25.05";
  nixpkgs.hostPlatform = "x86_64-linux";
  boot.loader.systemd-boot.enable = true;
  boot.loader.efi.canTouchEfiVariables = true;
  fileSystems."/" = { device = "nodev"; fsType = "tmpfs"; };
}
