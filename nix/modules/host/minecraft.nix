{ fleet, ... }:
{
  imports = [
    ../services/minecraft-identity.nix
    ../../../services/minecraft/nix/modules/minecraft-papermc.nix
  ];

  _module.args.minecraftContext = fleet.services.minecraft;

  systemd.tmpfiles.rules = [
    "d /persist/services/minecraft 0750 minecraft minecraft - -"
  ];
}
