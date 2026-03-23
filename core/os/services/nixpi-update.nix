{ config, lib, ... }:

let
  inherit (lib) mkOption types;
  pathOrStr = types.coercedTo types.path (x: "${x}") types.str;
in
{
  _class = "service";

  options.nixpi-update = {
    command = mkOption {
      type = pathOrStr;
    };

    primaryUser = mkOption {
      type = types.str;
    };

    path = mkOption {
      type = types.str;
    };

    flakeDir = mkOption {
      type = pathOrStr;
    };
  };

  config = {
    process.argv = [ config.nixpi-update.command ];

    systemd.service = {
      description = "NixPI NixOS update";
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      unitConfig = {
        ConditionPathExists = "${config.nixpi-update.flakeDir}/flake.nix";
      };
      serviceConfig = {
        Type = "oneshot";
        RemainAfterExit = false;
        Restart = "no";
        Environment = [
          "PATH=${config.nixpi-update.path}"
          "NIXPI_PRIMARY_USER=${config.nixpi-update.primaryUser}"
          "NIXPI_SYSTEM_FLAKE_DIR=${config.nixpi-update.flakeDir}"
        ];
      };
    };
  };
}
