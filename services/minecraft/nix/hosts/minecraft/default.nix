{ pkgs, ... }:
{
  imports = [
    ../../modules/minecraft-papermc.nix
    ../../modules/minecraft-web.nix
  ];

  # Canonical guest module for the Nazar MicroVM orchestrator. Hardware,
  # networking, lifecycle, and persistence are composed by the nazar fleet
  # baseline; this repository owns only Minecraft service behavior.
  environment.systemPackages = [
    pkgs.nodejs
  ];

  system.stateVersion = "26.05";
}
