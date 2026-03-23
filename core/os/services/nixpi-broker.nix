{ config, lib, ... }:

let
  inherit (lib) mkOption types;
  pathOrStr = types.coercedTo types.path (x: "${x}") types.str;
in
{
  _class = "service";

  options.nixpi-broker = {
    command = mkOption {
      type = types.str;
    };

    brokerConfig = mkOption {
      type = pathOrStr;
    };

    stateDir = mkOption {
      type = types.pathWith { absolute = true; };
    };
  };

  config = {
    process.argv = [
      config.nixpi-broker.command
      "server"
    ];

    systemd.service = {
      description = "NixPI privileged operations broker";
      after = [ "network.target" ];
      wantedBy = [ "multi-user.target" ];
      serviceConfig = {
        User = "root";
        Group = "root";
        RuntimeDirectory = "nixpi-broker";
        RuntimeDirectoryMode = "0770";
        UMask = "0007";
        Environment = [ "NIXPI_BROKER_CONFIG=${config.nixpi-broker.brokerConfig}" ];
      };
    };
  };
}
