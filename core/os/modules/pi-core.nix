{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.nixpi.piCore;
  corePackage = pkgs.callPackage ../pkgs/pi-core { };
  coreConfig = pkgs.writeText "nixpi-pi-core.json" (
    builtins.toJSON {
      server = {
        socketPath = cfg.socketPath;
      };
      pi = {
        cwd = cfg.piCwd;
        sessionDir = cfg.sessionDir;
      };
    }
  );
  bootstrapMode = if config.nixpi.bootstrap.enable then "bootstrap" else "steady";
  defaultPiSettings = pkgs.writeText "nixpi-pi-core-settings.json" (
    builtins.toJSON {
      packages = config.nixpi.agent.packagePaths;
      shellPath = "${pkgs.bash}/bin/bash";
    }
  );
  defaultAgentSettings = pkgs.writeText "nixpi-pi-core-agent-settings.json" (
    builtins.toJSON {
      packages = cfg.packagePaths;
      extensions = cfg.extensionPaths;
      defaultProvider = cfg.defaultProvider;
      defaultModel = cfg.defaultModel;
    }
  );
  setupScript = pkgs.writeShellScript "nixpi-pi-core-setup" ''
    set -euo pipefail

    install -d -m 0700 -o ${cfg.user} -g ${cfg.group} \
      ${cfg.stateDir} \
      ${cfg.sessionDir} \
      ${cfg.agentDir} \
      ${cfg.agentDir}/agent

    if [ -d ${lib.escapeShellArg cfg.legacySessionDir} ] && [ ! -e ${cfg.sessionDir}/.migrated-from-legacy ]; then
      cp -a ${lib.escapeShellArg cfg.legacySessionDir}/. ${cfg.sessionDir}/
      touch ${cfg.sessionDir}/.migrated-from-legacy
    fi

    if [ -d ${lib.escapeShellArg cfg.legacyAgentDir} ] && [ ! -e ${cfg.agentDir}/.migrated-from-legacy-agent ]; then
      if [ -f ${lib.escapeShellArg cfg.legacyAgentDir}/auth.json ] && [ ! -e ${cfg.agentDir}/auth.json ]; then
        install -m 0600 -o ${cfg.user} -g ${cfg.group} ${lib.escapeShellArg cfg.legacyAgentDir}/auth.json ${cfg.agentDir}/auth.json
      fi

      if [ -f ${lib.escapeShellArg cfg.legacyAgentDir}/settings.json ] && [ ! -e ${cfg.agentDir}/settings.json ]; then
        install -m 0644 -o ${cfg.user} -g ${cfg.group} ${lib.escapeShellArg cfg.legacyAgentDir}/settings.json ${cfg.agentDir}/settings.json
      fi

      if [ -f ${lib.escapeShellArg cfg.legacyAgentDir}/agent/settings.json ] && [ ! -e ${cfg.agentDir}/agent/settings.json ]; then
        install -m 0644 -o ${cfg.user} -g ${cfg.group} ${lib.escapeShellArg cfg.legacyAgentDir}/agent/settings.json ${cfg.agentDir}/agent/settings.json
      fi

      if [ -d ${lib.escapeShellArg cfg.legacyAgentDir}/agent/extensions ] && [ ! -e ${cfg.agentDir}/agent/extensions ]; then
        cp -a ${lib.escapeShellArg cfg.legacyAgentDir}/agent/extensions ${cfg.agentDir}/agent/extensions
      fi

      if [ -d ${lib.escapeShellArg cfg.legacyAgentDir}/agent/local-packages ] && [ ! -e ${cfg.agentDir}/agent/local-packages ]; then
        cp -a ${lib.escapeShellArg cfg.legacyAgentDir}/agent/local-packages ${cfg.agentDir}/agent/local-packages
      fi

      touch ${cfg.agentDir}/.migrated-from-legacy-agent
    fi

    if [ ! -e ${cfg.agentDir}/.seeded-from-source-agent ]; then
      if [ -f ${lib.escapeShellArg cfg.sourceAgentDir}/auth.json ] && [ ! -e ${cfg.agentDir}/auth.json ]; then
        install -m 0600 -o ${cfg.user} -g ${cfg.group} ${lib.escapeShellArg cfg.sourceAgentDir}/auth.json ${cfg.agentDir}/auth.json
      fi

      if [ -d ${lib.escapeShellArg cfg.sourceAgentDir}/agent/extensions ] && [ ! -e ${cfg.agentDir}/agent/extensions ]; then
        cp -a ${lib.escapeShellArg cfg.sourceAgentDir}/agent/extensions ${cfg.agentDir}/agent/extensions
      fi

      if [ -d ${lib.escapeShellArg cfg.sourceAgentDir}/agent/local-packages ] && [ ! -e ${cfg.agentDir}/agent/local-packages ]; then
        cp -a ${lib.escapeShellArg cfg.sourceAgentDir}/agent/local-packages ${cfg.agentDir}/agent/local-packages
      fi

      touch ${cfg.agentDir}/.seeded-from-source-agent
    fi

    install -m 0644 -o ${cfg.user} -g ${cfg.group} ${defaultPiSettings} ${cfg.agentDir}/settings.json
    install -m 0644 -o ${cfg.user} -g ${cfg.group} ${defaultAgentSettings} ${cfg.agentDir}/agent/settings.json

    if [ -e ${cfg.agentDir}/auth.json ]; then
      ln -sfn ../auth.json ${cfg.agentDir}/agent/auth.json
    else
      rm -f ${cfg.agentDir}/agent/auth.json
    fi

    ${pkgs.acl}/bin/setfacl -m u:${cfg.user}:--x,m::--x ${lib.escapeShellArg config.nixpi.stateDir}
    ${pkgs.acl}/bin/setfacl -m u:${cfg.user}:--x,m::--x ${lib.escapeShellArg cfg.homeTraversePath}
    ${pkgs.acl}/bin/setfacl -R -m u:${cfg.user}:rwX,m::rwX ${lib.escapeShellArg cfg.workspaceDir}
    ${pkgs.acl}/bin/setfacl -R -m d:u:${cfg.user}:rwX,d:m::rwX ${lib.escapeShellArg cfg.workspaceDir}

    chown -R ${cfg.user}:${cfg.group} ${cfg.stateDir} ${cfg.agentDir}
  '';
in
{
  imports = [ ./options.nix ];

  config = lib.mkIf cfg.enable {
    users.groups.${cfg.group} = { };
    users.users.${cfg.user} = {
      isSystemUser = true;
      group = cfg.group;
      home = cfg.agentDir;
      createHome = false;
      description = "NixPI Pi core service account";
    };

    environment.systemPackages = [ corePackage ];

    systemd.tmpfiles.settings.nixpi-pi-core = {
      "${cfg.stateDir}".d = {
        mode = "0700";
        user = cfg.user;
        group = cfg.group;
      };
      "${builtins.dirOf cfg.socketPath}".d = {
        mode = "0750";
        user = cfg.user;
        group = cfg.group;
      };
      "${cfg.sessionDir}".d = {
        mode = "0700";
        user = cfg.user;
        group = cfg.group;
      };
      "${cfg.agentDir}".d = {
        mode = "0700";
        user = cfg.user;
        group = cfg.group;
      };
      "${cfg.agentDir}/agent".d = {
        mode = "0700";
        user = cfg.user;
        group = cfg.group;
      };
    };

    systemd.services.nixpi-pi-core-setup = {
      description = "NixPI Pi core setup and migration";
      wantedBy = [ "multi-user.target" ];
      before = [ "nixpi-pi-core.service" ];
      after = [ "systemd-tmpfiles-setup.service" "nixpi-app-setup.service" ];
      requires = [ "nixpi-app-setup.service" ];
      serviceConfig = {
        Type = "oneshot";
        User = "root";
        Group = "root";
        RemainAfterExit = true;
        ExecStart = setupScript;
      };
      restartTriggers = [ coreConfig defaultPiSettings defaultAgentSettings ];
    };

    systemd.services.nixpi-pi-core = {
      description = "NixPI Pi core";
      wantedBy = [ "multi-user.target" ];
      after = [ "network-online.target" "nixpi-pi-core-setup.service" ];
      wants = [ "network-online.target" "nixpi-pi-core-setup.service" ];
      restartTriggers = [ coreConfig defaultPiSettings defaultAgentSettings ];
      serviceConfig = {
        Type = "simple";
        User = cfg.user;
        Group = cfg.group;
        WorkingDirectory = cfg.agentDir;
        ExecStart = lib.escapeShellArgs [ "${corePackage}/bin/nixpi-pi-core" coreConfig ];
        Restart = "on-failure";
        RestartSec = 3;
        UMask = "0007";
        Environment = [
          "HOME=${cfg.agentDir}"
          "PI_CODING_AGENT_DIR=${cfg.agentDir}"
          "NIXPI_PI_DIR=${cfg.agentDir}"
          "NIXPI_DIR=${cfg.workspaceDir}"
          "NIXPI_STATE_DIR=${config.nixpi.stateDir}"
          "NIXPI_BOOTSTRAP_MODE=${bootstrapMode}"
        ];
      };
    };
  };
}
