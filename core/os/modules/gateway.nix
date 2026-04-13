{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.nixpi.gateway;
  piCoreCfg = config.nixpi.piCore;
  signalCfg = cfg.modules.signal;
  gatewayPackage = pkgs.callPackage ../pkgs/pi-gateway { };
  signalCliDataDir = "${signalCfg.stateDir}/signal-cli-data";
  enabledModuleCount = lib.length (lib.filter (x: x) [ signalCfg.enable ]);
  gatewayConfig = pkgs.writeText "nixpi-gateway.yml" (
    lib.generators.toYAML { } {
      gateway = {
        dbPath = "${cfg.stateDir}/gateway.db";
        maxReplyChars = cfg.maxReplyChars;
        maxReplyChunks = cfg.maxReplyChunks;
      };
      piCore.socketPath = piCoreCfg.socketPath;
      modules = lib.optionalAttrs signalCfg.enable {
        signal = {
          enabled = true;
          account = signalCfg.account;
          httpUrl = "http://127.0.0.1:${toString signalCfg.port}";
          allowedNumbers = signalCfg.allowedNumbers;
          adminNumbers = signalCfg.adminNumbers;
          directMessagesOnly = signalCfg.directMessagesOnly;
        };
      };
    }
  );
  waitForDependencies = pkgs.writeShellScript "nixpi-gateway-wait-for-dependencies" ''
    set -euo pipefail

    for _ in $(seq 1 30); do
      if ${pkgs.curl}/bin/curl --unix-socket ${lib.escapeShellArg piCoreCfg.socketPath} -fsS http://localhost/api/v1/health >/dev/null; then
        break
      fi
      sleep 1
    done

    ${pkgs.curl}/bin/curl --unix-socket ${lib.escapeShellArg piCoreCfg.socketPath} -fsS http://localhost/api/v1/health >/dev/null

${lib.optionalString signalCfg.enable ''
    for _ in $(seq 1 30); do
      if ${pkgs.curl}/bin/curl -fsS http://127.0.0.1:${toString signalCfg.port}/api/v1/check >/dev/null; then
        break
      fi
      sleep 1
    done

    ${pkgs.curl}/bin/curl -fsS http://127.0.0.1:${toString signalCfg.port}/api/v1/check >/dev/null
''}
  '';
  setupScript = pkgs.writeShellScript "nixpi-gateway-setup" ''
    set -euo pipefail

    install -d -m 0700 -o ${cfg.user} -g ${cfg.group} \
      ${cfg.stateDir} \
      ${cfg.stateDir}/tmp

${lib.optionalString signalCfg.enable ''
    install -d -m 0700 -o ${cfg.user} -g ${cfg.group} \
      ${signalCfg.stateDir} \
      ${signalCliDataDir}
''}

    migrate_legacy_state() {
      local legacy_dir="$1"
      [ -d "$legacy_dir" ] || return 0

${lib.optionalString signalCfg.enable ''
      if [ -d "$legacy_dir/signal-cli-data" ] \
        && [ ! -e ${signalCliDataDir}/accounts.json ] \
        && [ ! -e ${signalCliDataDir}/data/accounts.json ]; then
        cp -a "$legacy_dir/signal-cli-data/." ${signalCliDataDir}/
      fi
''}

      for dbFile in gateway.db gateway.db-shm gateway.db-wal; do
        if [ -e "$legacy_dir/$dbFile" ] && [ ! -e ${cfg.stateDir}/$dbFile ]; then
          cp -a "$legacy_dir/$dbFile" ${cfg.stateDir}/$dbFile
        fi
      done
    }

    if [ ! -e ${cfg.stateDir}/.migrated-from-legacy ]; then
      migrate_legacy_state ${lib.escapeShellArg cfg.legacyStateDir}
      migrate_legacy_state ${lib.escapeShellArg cfg.legacyRootStateDir}
      touch ${cfg.stateDir}/.migrated-from-legacy
    fi

    ${pkgs.acl}/bin/setfacl -x u:${cfg.user} ${lib.escapeShellArg piCoreCfg.homeTraversePath} 2>/dev/null || true
    ${pkgs.acl}/bin/setfacl -R -x u:${cfg.user} ${lib.escapeShellArg piCoreCfg.workspaceDir} 2>/dev/null || true
    ${pkgs.acl}/bin/setfacl -R -x d:u:${cfg.user} ${lib.escapeShellArg piCoreCfg.workspaceDir} 2>/dev/null || true

    chown -R ${cfg.user}:${cfg.group} ${cfg.stateDir}
  '';
in
{
  imports = [ ./options.nix ];

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = enabledModuleCount > 0;
        message = "At least one nixpi.gateway.modules.* transport must be enabled when nixpi.gateway.enable is true.";
      }
      {
        assertion = piCoreCfg.enable;
        message = "nixpi.piCore.enable must be true when nixpi.gateway.enable is true.";
      }
    ] ++ lib.optionals signalCfg.enable [
      {
        assertion = signalCfg.account != "";
        message = "nixpi.gateway.modules.signal.account must not be empty when the Signal module is enabled.";
      }
      {
        assertion = signalCfg.allowedNumbers != [ ];
        message = "nixpi.gateway.modules.signal.allowedNumbers must not be empty when the Signal module is enabled.";
      }
    ];

    users.groups.${cfg.group} = { };
    users.users.${cfg.user} = {
      isSystemUser = true;
      group = cfg.group;
      home = cfg.stateDir;
      createHome = false;
      description = "NixPI gateway service account";
    };

    environment.systemPackages = [ gatewayPackage ] ++ lib.optional signalCfg.enable pkgs.signal-cli;

    systemd.tmpfiles.settings.nixpi-gateway = {
      "${cfg.stateDir}".d = {
        mode = "0700";
        user = cfg.user;
        group = cfg.group;
      };
      "${cfg.stateDir}/tmp".d = {
        mode = "0700";
        user = cfg.user;
        group = cfg.group;
      };
    } // lib.optionalAttrs signalCfg.enable {
      "${signalCfg.stateDir}".d = {
        mode = "0700";
        user = cfg.user;
        group = cfg.group;
      };
      "${signalCliDataDir}".d = {
        mode = "0700";
        user = cfg.user;
        group = cfg.group;
      };
    };

    systemd.services.nixpi-gateway-setup = {
      description = "NixPI gateway setup and migration";
      wantedBy = [ "multi-user.target" ];
      before = [ "nixpi-gateway.service" ] ++ lib.optionals signalCfg.enable [ "nixpi-signal-daemon.service" ];
      after = [ "systemd-tmpfiles-setup.service" ];
      serviceConfig = {
        Type = "oneshot";
        User = "root";
        Group = "root";
        RemainAfterExit = true;
        ExecStart = setupScript;
      };
      restartTriggers = [ gatewayConfig ];
      aliases = [ "nixpi-signal-gateway-setup.service" ];
    };

    systemd.services.nixpi-signal-daemon = lib.mkIf signalCfg.enable {
      description = "NixPI Signal transport daemon";
      wantedBy = [ "multi-user.target" ];
      after = [ "network-online.target" "nixpi-gateway-setup.service" ];
      wants = [ "network-online.target" "nixpi-gateway-setup.service" ];
      serviceConfig = {
        Type = "simple";
        User = cfg.user;
        Group = cfg.group;
        WorkingDirectory = signalCfg.stateDir;
        ExecStart = lib.escapeShellArgs [
          "${pkgs.signal-cli}/bin/signal-cli"
          "--config"
          signalCliDataDir
          "-a"
          signalCfg.account
          "daemon"
          "--http"
          "127.0.0.1:${toString signalCfg.port}"
          "--receive-mode"
          "on-start"
          "--ignore-attachments"
        ];
        Restart = "on-failure";
        RestartSec = 3;
      };
    };

    systemd.services.nixpi-gateway = {
      description = "NixPI gateway";
      wantedBy = [ "multi-user.target" ];
      after = [ "network-online.target" "nixpi-pi-core.service" "nixpi-gateway-setup.service" ] ++ lib.optionals signalCfg.enable [ "nixpi-signal-daemon.service" ];
      wants = [ "network-online.target" "nixpi-pi-core.service" "nixpi-gateway-setup.service" ] ++ lib.optionals signalCfg.enable [ "nixpi-signal-daemon.service" ];
      aliases = [ "nixpi-signal-gateway.service" ];
      restartTriggers = [ gatewayConfig ];
      serviceConfig = {
        Type = "simple";
        User = cfg.user;
        Group = cfg.group;
        WorkingDirectory = cfg.stateDir;
        SupplementaryGroups = [ piCoreCfg.group ];
        ExecStartPre = waitForDependencies;
        ExecStart = lib.escapeShellArgs [ "${gatewayPackage}/bin/nixpi-gateway" gatewayConfig ];
        Restart = "on-failure";
        RestartSec = 3;
      };
    };
  };
}
