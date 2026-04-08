{
  config,
  lib,
  pkgs,
  ...
}:

let
  inherit (config.nixpi) primaryUser stateDir;
  socketDir = "/run/nixpi-broker";
  socketPath = "${socketDir}/broker.sock";
  brokerStateDir = "${stateDir}/broker";
  elevationPath = "${brokerStateDir}/elevation.json";

  brokerConfig = pkgs.writeText "nixpi-broker-config.json" (
    builtins.toJSON {
      inherit
        socketPath
        elevationPath
        brokerStateDir
        primaryUser
        ;
      defaultAutonomy = config.nixpi.agent.autonomy;
      elevationDuration = config.nixpi.agent.elevation.duration;
      osUpdateEnable = config.nixpi.agent.osUpdate.enable;
      inherit (config.nixpi.agent) allowedUnits;
      defaultFlake = "/etc/nixos#nixos";
    }
  );

  brokerProgram = pkgs.callPackage ../pkgs/broker { };

  brokerCtl = pkgs.writeShellScriptBin "nixpi-brokerctl" ''
    export NIXPI_BROKER_CONFIG=${brokerConfig}
    exec ${brokerProgram}/bin/nixpi-broker "$@"
  '';
  brokerCtlCommand = "/run/current-system/sw/bin/nixpi-brokerctl";
in
{
  imports = [ ./options.nix ];

  config = lib.mkIf config.nixpi.agent.broker.enable {
    assertions = [
      {
        assertion = config.nixpi.agent.autonomy != "";
        message = "nixpi.agent.autonomy must not be empty.";
      }
      {
        assertion = config.nixpi.agent.elevation.duration != "";
        message = "nixpi.agent.elevation.duration must not be empty.";
      }
    ];

    environment.systemPackages = [ brokerCtl ];

    systemd.tmpfiles.settings.nixpi-broker = {
      "${socketDir}".d = {
        mode = "0770";
        user = "root";
        group = primaryUser;
      };
      "${brokerStateDir}".d = {
        mode = "0770";
        user = "root";
        group = primaryUser;
      };
    };

    systemd.sockets.nixpi-broker = {
      description = "NixPI privileged operations broker socket";
      wantedBy = [ "sockets.target" ];
      socketConfig = {
        ListenStream = socketPath;
        SocketUser = "root";
        SocketGroup = primaryUser;
        SocketMode = "0660";
        Service = "nixpi-broker.service";
        RemoveOnStop = true;
      };
    };

    systemd.services.nixpi-broker = {
      description = "NixPI privileged operations broker";
      serviceConfig = {
        ExecStart = "${brokerCtl}/bin/nixpi-brokerctl server";
        User = "root";
        Group = "root";
        Restart = "always";
        RestartSec = 5;
        UMask = "0007";
        Environment = [ "NIXPI_BROKER_CONFIG=${brokerConfig}" ];
      };
    };

    security.sudo.extraRules =
      lib.optionals (config.nixpi.bootstrap.temporaryAdmin.enable && primaryUser != "") [
        {
          users = [ primaryUser ];
          commands = [
            {
              command = "ALL";
              options = [ "NOPASSWD" ];
            }
          ];
        }
      ]
      ++ lib.optional (primaryUser != "") {
        users = [ primaryUser ];
        commands = [
          {
            command = "${brokerCtlCommand} grant-admin *";
            options = [ "NOPASSWD" ];
          }
          {
            command = "${brokerCtlCommand} revoke-admin";
            options = [ "NOPASSWD" ];
          }
          {
            command = "${brokerCtlCommand} status";
            options = [ "NOPASSWD" ];
          }
        ];
      };
  };
}
