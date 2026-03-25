{ config, ... }:

let
  primaryUser = config.nixpi.primaryUser;
  stateDir = config.nixpi.stateDir;
in
{
  imports = [ ../options.nix ];

  systemd.tmpfiles.rules = [
    "d ${stateDir}/bootstrap 0770 ${primaryUser} ${primaryUser} -"
  ];
}
