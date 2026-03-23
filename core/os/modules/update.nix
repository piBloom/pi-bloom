# core/os/modules/update.nix
{ pkgs, lib, config, ... }:

let
  primaryUser = config.nixpi.primaryUser;
in

{
  nix.settings.experimental-features = [ "nix-command" "flakes" ];

  assertions = [
    {
      assertion = config.nixpi.update.onBootSec != "";
      message = "nixpi.update.onBootSec must not be empty.";
    }
    {
      assertion = config.nixpi.update.interval != "";
      message = "nixpi.update.interval must not be empty.";
    }
  ];

  system.services.nixpi-update = {
    imports = [ ../services/nixpi-update.nix ];
    nixpi-update = {
      command = pkgs.writeShellScript "nixpi-update" (builtins.readFile ../../../core/scripts/system-update.sh);
      inherit primaryUser;
      flakeDir = "/etc/nixos";
      path = "/run/current-system/sw/bin:${lib.makeBinPath (with pkgs; [ nix git jq ])}";
    };
  };

  systemd.timers.nixpi-update = {
    description = "NixPI update check timer";
    wantedBy    = [ "timers.target" ];

    timerConfig = {
      OnBootSec        = config.nixpi.update.onBootSec;
      OnUnitActiveSec  = config.nixpi.update.interval;
      Persistent       = true;
    };
  };
}
