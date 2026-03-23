{ pkgs }:

{ config, lib, ... }:

let
  inherit (lib) mkOption types;
  primaryHome = "/home/${config.nixpi-daemon.primaryUser}";
in
{
  _class = "service";

  options.nixpi-daemon = {
    package = mkOption {
      type = types.package;
    };

    primaryUser = mkOption {
      type = types.str;
    };

    stateDir = mkOption {
      type = types.pathWith { absolute = true; };
    };

    agentStateDir = mkOption {
      type = types.pathWith { absolute = true; };
    };

    path = mkOption {
      type = types.listOf types.package;
      default = [ ];
    };
  };

  config = {
    process.argv = [
      "${pkgs.nodejs}/bin/node"
      "/usr/local/share/nixpi/dist/core/daemon/index.js"
    ];

    systemd.service = {
      description = "NixPI Pi Daemon (Matrix room agent)";
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      wantedBy = [ "multi-user.target" ];
      unitConfig.ConditionPathExists = "${primaryHome}/.nixpi/.setup-complete";
      serviceConfig = {
        User = config.nixpi-daemon.primaryUser;
        Group = config.nixpi-daemon.primaryUser;
        UMask = "0007";
        WorkingDirectory = "${primaryHome}/nixpi";
        Environment = [
          "HOME=${primaryHome}"
          "NIXPI_DIR=${primaryHome}/nixpi"
          "NIXPI_STATE_DIR=${config.nixpi-daemon.stateDir}"
          "NIXPI_PI_DIR=${config.nixpi-daemon.agentStateDir}"
          "NIXPI_DAEMON_STATE_DIR=${config.nixpi-daemon.stateDir}/nixpi-daemon"
          "NIXPI_PRIMARY_USER=${config.nixpi-daemon.primaryUser}"
          "PATH=${lib.makeBinPath config.nixpi-daemon.path}:/run/current-system/sw/bin"
        ];
        Restart = "on-failure";
        RestartSec = "15";
        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectSystem = "strict";
        ProtectHome = false;
        ReadWritePaths = [
          config.nixpi-daemon.stateDir
          "${primaryHome}/nixpi"
        ];
      };
    };
  };
}
