{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.nixpi.signalGateway;
  gatewayPackage = pkgs.callPackage ../pkgs/signal-gateway { };
  gatewayConfig = pkgs.writeText "nixpi-signal-gateway.yml" (
    lib.generators.toYAML { } {
      signal = {
        account = cfg.account;
        httpUrl = "http://127.0.0.1:${toString cfg.port}";
      };
      gateway = {
        dbPath = "${cfg.stateDir}/gateway.db";
        piSessionDir = "${cfg.stateDir}/pi-sessions";
        maxReplyChars = cfg.maxReplyChars;
        maxReplyChunks = cfg.maxReplyChunks;
        directMessagesOnly = cfg.directMessagesOnly;
      };
      pi.cwd = cfg.piCwd;
      auth = {
        allowedNumbers = cfg.allowedNumbers;
        adminNumbers = cfg.adminNumbers;
      };
    }
  );
  bootstrapMode = if config.nixpi.bootstrap.enable then "bootstrap" else "steady";
  defaultPiSettings = pkgs.writeText "nixpi-signal-gateway-settings.json" (
    builtins.toJSON {
      packages = config.nixpi.agent.packagePaths;
      shellPath = "${pkgs.bash}/bin/bash";
    }
  );
  defaultAgentSettings = pkgs.writeText "nixpi-signal-gateway-agent-settings.json" (
    builtins.toJSON {
      packages = cfg.packagePaths;
      extensions = cfg.extensionPaths;
      defaultProvider = cfg.defaultProvider;
      defaultModel = cfg.defaultModel;
    }
  );
  setupScript = pkgs.writeShellScript "nixpi-signal-gateway-setup" ''
    set -euo pipefail

    install -d -m 0700 -o ${cfg.user} -g ${cfg.group} \
      ${cfg.stateDir} \
      ${cfg.stateDir}/signal-cli-data \
      ${cfg.stateDir}/pi-sessions \
      ${cfg.stateDir}/tmp \
      ${cfg.agentDir} \
      ${cfg.agentDir}/agent

    if [ -d ${lib.escapeShellArg cfg.legacyStateDir} ] && [ ! -e ${cfg.stateDir}/.migrated-from-legacy ]; then
      if [ -d ${lib.escapeShellArg cfg.legacyStateDir}/signal-cli-data ] && [ ! -e ${cfg.stateDir}/signal-cli-data/accounts.json ]; then
        cp -a ${lib.escapeShellArg cfg.legacyStateDir}/signal-cli-data/. ${cfg.stateDir}/signal-cli-data/
      fi
      if [ -d ${lib.escapeShellArg cfg.legacyStateDir}/pi-sessions ] && [ ! -d ${cfg.stateDir}/pi-sessions/.seeded ]; then
        cp -a ${lib.escapeShellArg cfg.legacyStateDir}/pi-sessions/. ${cfg.stateDir}/pi-sessions/
      fi
      for dbFile in gateway.db gateway.db-shm gateway.db-wal; do
        if [ -e ${lib.escapeShellArg cfg.legacyStateDir}/$dbFile ] && [ ! -e ${cfg.stateDir}/$dbFile ]; then
          cp -a ${lib.escapeShellArg cfg.legacyStateDir}/$dbFile ${cfg.stateDir}/$dbFile
        fi
      done
      touch ${cfg.stateDir}/.migrated-from-legacy
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

    ${pkgs.acl}/bin/setfacl -m u:${cfg.user}:--x ${lib.escapeShellArg config.nixpi.stateDir}
    ${pkgs.acl}/bin/setfacl -m u:${cfg.user}:--x ${lib.escapeShellArg cfg.homeTraversePath}
    ${pkgs.acl}/bin/setfacl -R -m u:${cfg.user}:rwX ${lib.escapeShellArg cfg.workspaceDir}
    ${pkgs.acl}/bin/setfacl -R -m d:u:${cfg.user}:rwX ${lib.escapeShellArg cfg.workspaceDir}

    chown -R ${cfg.user}:${cfg.group} ${cfg.stateDir} ${cfg.agentDir}
  '';
in
{
  imports = [ ./options.nix ];

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = cfg.account != "";
        message = "nixpi.signalGateway.account must not be empty when the Signal gateway is enabled.";
      }
      {
        assertion = cfg.allowedNumbers != [ ];
        message = "nixpi.signalGateway.allowedNumbers must not be empty when the Signal gateway is enabled.";
      }
      {
        assertion = cfg.adminNumbers != [ ];
        message = "nixpi.signalGateway.adminNumbers must not be empty when the Signal gateway is enabled.";
      }
    ];

    users.groups.${cfg.group} = { };
    users.users.${cfg.user} = {
      isSystemUser = true;
      group = cfg.group;
      home = cfg.agentDir;
      createHome = false;
      description = "NixPI Signal gateway service account";
    };

    environment.systemPackages = [ gatewayPackage pkgs.signal-cli ];

    systemd.tmpfiles.settings.nixpi-signal-gateway = {
      "${cfg.stateDir}".d = {
        mode = "0700";
        user = cfg.user;
        group = cfg.group;
      };
      "${cfg.stateDir}/signal-cli-data".d = {
        mode = "0700";
        user = cfg.user;
        group = cfg.group;
      };
      "${cfg.stateDir}/pi-sessions".d = {
        mode = "0700";
        user = cfg.user;
        group = cfg.group;
      };
      "${cfg.stateDir}/tmp".d = {
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

    systemd.services.nixpi-signal-gateway-setup = {
      description = "NixPI Signal gateway setup and migration";
      wantedBy = [ "multi-user.target" ];
      before = [ "nixpi-signal-daemon.service" "nixpi-signal-gateway.service" ];
      after = [ "systemd-tmpfiles-setup.service" "nixpi-app-setup.service" ];
      requires = [ "nixpi-app-setup.service" ];
      serviceConfig = {
        Type = "oneshot";
        User = "root";
        Group = "root";
        RemainAfterExit = true;
        ExecStart = setupScript;
      };
      restartTriggers = [ gatewayConfig ];
    };

    systemd.services.nixpi-signal-daemon = {
      description = "NixPI Signal CLI daemon";
      wantedBy = [ "multi-user.target" ];
      after = [ "network-online.target" "nixpi-signal-gateway-setup.service" ];
      wants = [ "network-online.target" "nixpi-signal-gateway-setup.service" ];
      serviceConfig = {
        Type = "simple";
        User = cfg.user;
        Group = cfg.group;
        WorkingDirectory = cfg.workspaceDir;
        ExecStart = lib.escapeShellArgs [
          "${pkgs.signal-cli}/bin/signal-cli"
          "--config"
          "${cfg.stateDir}/signal-cli-data"
          "-a"
          cfg.account
          "daemon"
          "--http"
          "127.0.0.1:${toString cfg.port}"
          "--receive-mode"
          "on-start"
          "--ignore-attachments"
        ];
        Restart = "on-failure";
        RestartSec = 3;
      };
    };

    systemd.services.nixpi-signal-gateway = {
      description = "NixPI Signal gateway";
      wantedBy = [ "multi-user.target" ];
      after = [ "network-online.target" "nixpi-signal-daemon.service" "nixpi-signal-gateway-setup.service" ];
      wants = [ "network-online.target" "nixpi-signal-daemon.service" "nixpi-signal-gateway-setup.service" ];
      restartTriggers = [ defaultPiSettings defaultAgentSettings gatewayConfig ];
      serviceConfig = {
        Type = "simple";
        User = cfg.user;
        Group = cfg.group;
        WorkingDirectory = cfg.workspaceDir;
        ExecStart = lib.escapeShellArgs [ "${gatewayPackage}/bin/nixpi-signal-gateway" gatewayConfig ];
        Restart = "on-failure";
        RestartSec = 3;
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
