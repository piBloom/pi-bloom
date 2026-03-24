{ pkgs }:

{ config, lib, options, ... }:

let
  inherit (lib) mkOption types;
  primaryHome = "/home/${config.nixpi-daemon.primaryUser}";
  canonicalRepoDir = "/srv/nixpi";
  systemReadyFile = "${primaryHome}/.nixpi/wizard-state/system-ready";
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
    # `system.services` portability: guard systemd-specific config so this module
    # can be consumed by non-systemd init systems if NixOS ever supports them.
    # See nixpkgs nixos/README-modular-services.md.
  } // lib.optionalAttrs (options ? systemd) {
    systemd.service = {
      description = "NixPI Pi Daemon (Matrix room agent)";
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      wantedBy = [ "multi-user.target" ];
      unitConfig.ConditionPathExists = systemReadyFile;
      serviceConfig = {
        User = config.nixpi-daemon.primaryUser;
        Group = config.nixpi-daemon.primaryUser;
        UMask = "0007";
        WorkingDirectory = canonicalRepoDir;
        Environment = [
          "HOME=${primaryHome}"
          "NIXPI_DIR=${canonicalRepoDir}"
          "NIXPI_STATE_DIR=${config.nixpi-daemon.stateDir}"
          "NIXPI_PI_DIR=${config.nixpi-daemon.agentStateDir}"
          "PI_CODING_AGENT_DIR=${config.nixpi-daemon.agentStateDir}"
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
          canonicalRepoDir
        ];
      };
    };
  };
}
