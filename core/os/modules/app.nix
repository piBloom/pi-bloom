# core/os/modules/app.nix
{
  pkgs,
  lib,
  config,
  ...
}:

let
  cfg = config.nixpi.app;
  inherit (config.nixpi) primaryUser stateDir;
  inherit (config.nixpi.agent) piDir envFiles;
  agentStateDir = piDir;
  piAgent = pkgs.callPackage ../pkgs/pi { };
  appPackage = pkgs.callPackage ../pkgs/app { inherit piAgent; };
  sourceEnvFilesSnippet = lib.concatMapStringsSep "\n" (
    envFile:
    let
      quoted = lib.escapeShellArg (toString envFile);
    in
    ''
      if [ -r ${quoted} ]; then
        set -a
        . ${quoted}
        set +a
      fi
    ''
  ) envFiles;
  piCommand = pkgs.writeShellScriptBin "pi" ''
    export PI_SKIP_VERSION_CHECK=1
    export NIXPI_BOOTSTRAP_MODE="${if config.nixpi.bootstrap.enable then "bootstrap" else "steady"}"
    export PATH="${
      lib.makeBinPath [
        pkgs.bash
        pkgs.fd
        pkgs.ripgrep
      ]
    }:$PATH"
${sourceEnvFilesSnippet}
    exec ${appPackage}/share/nixpi/node_modules/.bin/pi "$@"
  '';
  defaultSettings = pkgs.writeText "pi-settings.json" (
    builtins.toJSON {
      packages = config.nixpi.agent.packagePaths;
      shellPath = "${pkgs.bash}/bin/bash";
    }
  );
  appSetupScript = pkgs.writeShellScript "nixpi-app-setup" ''
    ${pkgs.systemd}/bin/systemd-tmpfiles --create --prefix=${agentStateDir} --prefix=${stateDir} --prefix=/usr/local/share/nixpi

    if [ -e ${agentStateDir}/auth.json ]; then
      ln -sfn ../auth.json ${agentStateDir}/agent/auth.json
    else
      rm -f ${agentStateDir}/agent/auth.json
    fi
  '';
in

{
  imports = [ ./options.nix ];

  options.nixpi.app.enable = lib.mkOption {
    type = lib.types.bool;
    default = true;
    description = "Whether the NixPI Pi agent app service and packages are installed.";
  };

  config = lib.mkIf cfg.enable {
    environment.systemPackages = [
    appPackage
    piCommand
  ];

  systemd.tmpfiles.settings.nixpi-app = {
    "/usr/local/share/nixpi"."L+" = {
      argument = "${appPackage}/share/nixpi";
    };
    "/etc/nixpi/appservices".d = {
      mode = "0755";
      user = "root";
      group = "root";
    };
    "${stateDir}".d = {
      mode = "0770";
      user = primaryUser;
      group = primaryUser;
    };
    "${stateDir}/services".d = {
      mode = "0770";
      user = primaryUser;
      group = primaryUser;
    };
    "${stateDir}/secrets".d = {
      mode = "0750";
      user = "root";
      group = primaryUser;
    };
    "${agentStateDir}".d = {
      mode = "0700";
      user = primaryUser;
      group = primaryUser;
    };
    "${agentStateDir}/agent".d = {
      mode = "0700";
      user = primaryUser;
      group = primaryUser;
    };
    "${agentStateDir}/settings.json"."L+" = {
      argument = toString defaultSettings;
    };
  };

  systemd.services.nixpi-app-setup = {
    description = "NixPI app setup: apply declarative runtime tmpfiles";
    wantedBy = [ "multi-user.target" ];
    after = [ "systemd-tmpfiles-setup.service" ];
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
      User = "root";
      ExecStart = "${appSetupScript}";
    };
  };

  };

}
