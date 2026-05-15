{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.services.nixpi-bun;
  inherit (lib)
    concatMapStringsSep
    literalExpression
    mkEnableOption
    mkIf
    mkOption
    types
    ;

  packageDefault = pkgs.callPackage ../packages/nixpi-bun { };
  sourceFirewallRules = concatMapStringsSep "\n" (source: ''
    iptables -A nixos-fw -p tcp -s ${source} --dport ${toString cfg.port} -j nixos-fw-accept
  '') cfg.firewallAllowedSources;
  sourceFirewallStopRules = concatMapStringsSep "\n" (source: ''
    iptables -D nixos-fw -p tcp -s ${source} --dport ${toString cfg.port} -j nixos-fw-accept 2>/dev/null || true
  '') cfg.firewallAllowedSources;
  workspacesJson = if cfg.workspaces == { }
    then null
    else pkgs.writeText "nixpi-bun-workspaces.json" (builtins.toJSON {
      default = if cfg.defaultWorkspace != null
        then cfg.defaultWorkspace
        else lib.optionalString (cfg.workspaces != { })
          (lib.head (lib.attrNames cfg.workspaces));
      workspaces = lib.mapAttrs (_: ws: {
        inherit (ws) cwd mode context;
        sshHost = ws.sshHost;
        sshUser = ws.sshUser;
      }) cfg.workspaces;
    });
in
{
  options.services.nixpi-bun = {
    enable = mkEnableOption "NixPi Bun, the experimental Bun-native web interface for Pi Coding Agent";

    package = mkOption {
      type = types.package;
      default = packageDefault;
      defaultText = literalExpression "pkgs.callPackage ../packages/nixpi-bun { }";
      description = "NixPi Bun package to run.";
    };

    user = mkOption {
      type = types.str;
      default = "alex";
      description = "User that owns the Pi session and runs NixPi.";
    };

    group = mkOption {
      type = types.str;
      default = "users";
      description = "Group used for the NixPi service.";
    };

    home = mkOption {
      type = types.str;
      default = "/home/${cfg.user}";
      defaultText = literalExpression ''"/home/''${config.services.nixpi-bun.user}"'';
      description = "HOME used by Pi/NixPi Bun for configuration and session state.";
    };

    host = mkOption {
      type = types.str;
      default = "127.0.0.1";
      description = "Address NixPi binds to.";
    };

    port = mkOption {
      type = types.port;
      default = 4816;
      description = "Port NixPi Bun listens on.";
    };

    workingDirectory = mkOption {
      type = types.str;
      default = cfg.home;
      defaultText = literalExpression "config.services.nixpi-bun.home";
      description = "Working directory passed to Pi as NIXPI_CWD.";
    };

    piBinary = mkOption {
      type = types.str;
      default = "/run/current-system/sw/bin/pi";
      description = "Pi executable or absolute path used for `pi --mode rpc`.";
    };

    openFirewall = mkOption {
      type = types.bool;
      default = false;
      description = "Open the NixOS firewall for the NixPi port.";
    };

    firewallAllowedSources = mkOption {
      type = types.listOf types.str;
      default = [ ];
      example = [ "10.10.10.1" ];
      description = ''
        Optional source CIDRs/addresses allowed to reach NixPi Bun. When empty and
        openFirewall is true, the port is opened normally with allowedTCPPorts.
        When non-empty, source-restricted iptables rules are added instead.
      '';
    };

    sourceDir = mkOption {
      type = types.nullOr types.path;
      default = null;
      example = literalExpression ''"''${config.users.users.alex.home}/repos/nixpi-bun"'';
      description = ''
        Absolute path to a live-source checkout. When set, the service runs
        directly from this directory with Bun instead of the nix store package,
        so you can edit files and restart the service (or let systemd watch the
        dir) without rebuilding the VM. This fork has no runtime npm dependency
        requirement for live-source mode.
      '';
    };

    idleTimeoutMs = mkOption {
      type = types.ints.positive;
      default = 300000;
      description = ''
        Idle timeout in milliseconds before killing an inactive workspace's
        Pi subprocess. Only the active workspace's Pi runs; others are
        lazily killed after this timeout.
      '';
    };

    workspaces = mkOption {
      type = types.attrsOf (types.submodule {
        options = {
          cwd = mkOption {
            type = types.str;
            description = "Working directory for this workspace.";
          };
          mode = mkOption {
            type = types.enum [ "local" "ssh" ];
            default = "local";
            description = ''
              Connection mode. "local" runs Pi directly on the host.
              "ssh" connects to a remote VM via Pi's --host flag.
            '';
          };
          sshHost = mkOption {
            type = types.nullOr types.str;
            default = null;
            description = "Remote host for SSH-mode workspaces.";
          };
          sshUser = mkOption {
            type = types.str;
            default = cfg.user;
            description = "SSH user for remote workspaces.";
          };
          context = mkOption {
            type = types.str;
            default = "";
            description = "Human-readable context shown in the workspace switcher UI.";
          };
        };
      });
      default = { };
      example = literalExpression ''
        {
          nazar = {
            cwd = "/home/alex/nazar";
            mode = "local";
            context = "Nazar infrastructure (host)";
          };
          minecraft = {
            cwd = "/home/alex/minecraft";
            mode = "ssh";
            sshHost = "10.10.10.30";
            context = "Minecraft PaperMC server VM";
          };
        }
      '';
      description = ''
        Declarative workspace definitions. When non-empty, NixPi Bun runs in
        multi-workspace mode with a workspace switcher. When empty,
        NixPi Bun falls back to single-workspace mode using workingDirectory.
      '';
    };

    defaultWorkspace = mkOption {
      type = types.nullOr types.str;
      default = null;
      description = ''
        Name of the workspace to activate on boot. When null, the first
        workspace in the attrset is used.
      '';
    };

    environment = mkOption {
      type = types.attrsOf types.str;
      default = { };
      example = {
        OPENAI_API_KEY = "...";
      };
      description = "Extra environment variables for the NixPi service.";
    };
  };

  config = mkIf cfg.enable {
    environment.systemPackages = [ cfg.package ];

    systemd.tmpfiles.rules = [
      "d ${toString cfg.home}/.pi 0750 ${cfg.user} ${cfg.group} - -"
      "d ${toString cfg.home}/.pi/agent 0750 ${cfg.user} ${cfg.group} - -"
    ];

    systemd.services.nixpi-bun = {
      description = "NixPi Bun web interface for Pi Coding Agent";
      wantedBy = [ "multi-user.target" ];
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      environment = {
        HOME = toString cfg.home;
        USER = cfg.user;
        LOGNAME = cfg.user;
        NIXPI_HOST = cfg.host;
        NIXPI_PORT = toString cfg.port;
        NIXPI_CWD = toString cfg.workingDirectory;
        NIXPI_PI_BIN = cfg.piBinary;
        NIXPI_SSH_BIN = lib.getExe pkgs.openssh;
        NIXPI_IDLE_TIMEOUT_MS = toString cfg.idleTimeoutMs;
        NIXPI_WORKSPACES_CONFIG = if workspacesJson != null
          then "${workspacesJson}"
          else "";
        PI_SKIP_VERSION_CHECK = "1";
        PI_TELEMETRY = "0";
      }
      // cfg.environment;
      serviceConfig = {
        Type = "simple";
        User = cfg.user;
        Group = cfg.group;
        WorkingDirectory = if cfg.sourceDir != null then cfg.sourceDir else toString cfg.workingDirectory;
        ExecStart = if cfg.sourceDir != null
          then "${pkgs.bun}/bin/bun ${cfg.sourceDir}/server.js"
          else "${cfg.package}/bin/nixpi-bun";
        Restart = "on-failure";
        RestartSec = 3;
        UMask = "0027";
      };
      path = [ pkgs.openssh ];
    };

    networking.firewall.allowedTCPPorts = mkIf (cfg.openFirewall && cfg.firewallAllowedSources == [ ]) [
      cfg.port
    ];

    networking.firewall.extraCommands = mkIf (cfg.openFirewall && cfg.firewallAllowedSources != [ ]) sourceFirewallRules;
    networking.firewall.extraStopCommands = mkIf (cfg.openFirewall && cfg.firewallAllowedSources != [ ]) sourceFirewallStopRules;
  };
}
