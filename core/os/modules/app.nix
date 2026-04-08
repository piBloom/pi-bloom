# core/os/modules/app.nix
{
  pkgs,
  lib,
  config,
  ...
}:

let
  inherit (config.nixpi) primaryUser stateDir;
  primaryHome = "/home/${primaryUser}";
  agentStateDir = "${primaryHome}/.pi";
  piAgent = pkgs.callPackage ../pkgs/pi { };
  appPackage = pkgs.callPackage ../pkgs/app { inherit piAgent; };
  piCommand = pkgs.writeShellScriptBin "pi" ''
    export PI_SKIP_VERSION_CHECK=1
    export PATH="${
      lib.makeBinPath [
        pkgs.fd
        pkgs.ripgrep
      ]
    }:$PATH"
    exec ${appPackage}/share/nixpi/node_modules/.bin/pi "$@"
  '';
  defaultSettings = pkgs.writeText "pi-settings.json" (
    builtins.toJSON { packages = config.nixpi.agent.packagePaths; }
  );
in

{
  imports = [ ./options.nix ];

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
  };

  systemd.services.nixpi-app-setup = {
    description = "NixPI app setup: create agent state dir and seed default settings";
    wantedBy = [ "multi-user.target" ];
    after = [ "systemd-tmpfiles-setup.service" ];
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
      User = "root";
      ExecStart = "${pkgs.writeShellScript "nixpi-app-setup" ''
        primary_group="$(id -gn ${primaryUser})"

        install -d -m 0700 -o ${primaryUser} -g "$primary_group" ${agentStateDir}
        install -d -m 0700 -o ${primaryUser} -g "$primary_group" ${agentStateDir}/agent

        if [ ! -e ${agentStateDir}/settings.json ]; then
          install -m 0600 -o ${primaryUser} -g "$primary_group" ${defaultSettings} ${agentStateDir}/settings.json
        fi

        if [ -e ${agentStateDir}/auth.json ] && [ ! -e ${agentStateDir}/agent/auth.json ]; then
          ln -s ../auth.json ${agentStateDir}/agent/auth.json
        fi

        chown -R ${primaryUser}:"$primary_group" ${agentStateDir}
        chmod 0700 ${agentStateDir}
      ''}";
    };
  };

}
