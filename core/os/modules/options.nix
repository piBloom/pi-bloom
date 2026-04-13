# core/os/modules/options.nix
# Flat cross-cutting NixPI option declarations (merged from options/ sub-files).
{ lib, config, ... }:

let
  absolutePath = lib.types.pathWith { absolute = true; };
  cfg = config.nixpi.bootstrap;
in
{
  options.nixpi = {
    primaryUser = lib.mkOption {
      type = lib.types.str;
      default = "pi";
      description = "Primary human/operator account for the NixPI machine.";
    };

    allowPrimaryUserChange = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = ''
        Allow a one-time intentional change to `nixpi.primaryUser` on an
        already-activated system. When false, NixPI aborts activation before
        user management if the configured primary user drifts from the recorded
        operator account.
      '';
    };

    stateDir = lib.mkOption {
      type = absolutePath;
      default = "/var/lib/nixpi";
      description = "Root directory for service-owned NixPI state.";
    };

    timezone = lib.mkOption {
      type = lib.types.str;
      default = "UTC";
      description = "System timezone (IANA string, e.g. Europe/Paris).";
    };

    keyboard = lib.mkOption {
      type = lib.types.str;
      default = "us";
      description = "Console keyboard layout (e.g. fr, de, us).";
    };

    flake = lib.mkOption {
      type = lib.types.str;
      default = "/etc/nixos#nixos";
      description = "Flake URI for this NixPI system used by auto-upgrade and the broker.";
    };

    update = {
      onBootSec = lib.mkOption {
        type = lib.types.str;
        default = "5min";
        description = "Delay before the first automatic update check after boot.";
      };
      interval = lib.mkOption {
        type = lib.types.str;
        default = "6h";
        description = "Recurrence interval for the automatic update timer.";
      };
    };

    security = {
      fail2ban.enable = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = ''
          Whether fail2ban protects SSH against brute-force attempts.
          Defaults false so bootstrap and steady-state hosts only enable it intentionally.
        '';
      };
      ssh.passwordAuthentication = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Whether SSH password authentication is enabled.";
      };
      ssh.allowedSourceCIDRs = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [ ];
        example = [ "198.51.100.10/32" "2001:db8::/48" ];
        description = "Source CIDRs allowed to reach the public SSH service.";
      };
      ssh.allowUsers = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [ ];
        description = "Explicit SSH login allowlist. Empty = restrict to primaryUser.";
      };
      trustedInterface = lib.mkOption {
        type = lib.types.str;
        default = "wt0";
        description = "Network interface trusted for NixPI service surface.";
      };
      enforceServiceFirewall = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Whether NixPI service ports are opened only on the trusted interface.";
      };
      passwordlessSudo.enable = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Deprecated blanket passwordless sudo escape hatch. Keep false; use broker instead.";
      };
    };

    bootstrap = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = ''
          Whether the system is intentionally configured in bootstrap mode.
          Bootstrap mode is declarative: it enables the temporary operator
          affordances needed before the host is locked down.
        '';
      };
      ssh.enable = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Whether SSH is exposed for the selected NixPI system state. Defaults true so steady-state hosts remain remotely reachable unless explicitly locked down.";
      };
      temporaryAdmin.enable = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Whether the primary operator receives the declarative bootstrap-time passwordless sudo grant.";
      };
    };

    integrations.exa = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Whether Exa-backed web search tools are enabled for the Pi runtime.";
      };
      envFile = lib.mkOption {
        type = absolutePath;
        description = "Absolute path to an environment file that provides EXA_API_KEY for the Pi runtime.";
      };
    };

    gateway = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Whether the generic NixPI gateway framework is managed as system services.";
      };
      user = lib.mkOption {
        type = lib.types.str;
        default = "nixpi-gateway";
        description = "System account that runs the generic gateway and its transport daemons.";
      };
      group = lib.mkOption {
        type = lib.types.str;
        default = "nixpi-gateway";
        description = "Primary group for the gateway system account.";
      };
      stateDir = lib.mkOption {
        type = absolutePath;
        default = "${config.nixpi.stateDir}/gateway";
        description = "Absolute path holding generic gateway runtime state such as SQLite metadata, Pi sessions, and transport-specific state.";
      };
      legacyStateDir = lib.mkOption {
        type = absolutePath;
        default = "${config.nixpi.stateDir}/signal-gateway";
        description = "Previous dedicated Signal gateway state root used as the source for one-time migration into the generic gateway state directory.";
      };
      legacyRootStateDir = lib.mkOption {
        type = absolutePath;
        default = "/root/.local/state/nixpi-signal-gateway";
        description = "Older root-owned Signal gateway runtime state path used as an additional one-time migration source.";
      };
      agentDir = lib.mkOption {
        type = absolutePath;
        default = "${config.nixpi.stateDir}/gateway-pi";
        description = "Service-owned Pi agent directory containing auth, settings, copied extensions, and local packages for the generic gateway account.";
      };
      legacyAgentDir = lib.mkOption {
        type = absolutePath;
        default = "${config.nixpi.stateDir}/signal-gateway-pi";
        description = "Previous dedicated Signal gateway Pi home used as the source for one-time migration into the generic gateway Pi home.";
      };
      sourceAgentDir = lib.mkOption {
        type = absolutePath;
        default = config.nixpi.agent.piDir;
        description = "Source Pi agent directory used to seed the generic gateway service-owned agent home when no migrated copy exists yet.";
      };
      workspaceDir = lib.mkOption {
        type = absolutePath;
        default = config.nixpi.agent.workspaceDir;
        description = "Workspace path the gateway service user may access so channel sessions can operate on the main NixPI workspace.";
      };
      homeTraversePath = lib.mkOption {
        type = absolutePath;
        default = "/home/${config.nixpi.primaryUser}";
        description = "Parent home path that receives execute-only ACL access so the gateway service user can reach the configured workspace directory.";
      };
      piCwd = lib.mkOption {
        type = lib.types.str;
        default = "/home/${config.nixpi.primaryUser}";
        description = "Working directory used as the Pi SDK cwd for gateway conversations.";
      };
      defaultProvider = lib.mkOption {
        type = lib.types.str;
        default = "cortecs";
        description = "Default Pi provider used by the gateway's dedicated Pi home.";
      };
      defaultModel = lib.mkOption {
        type = lib.types.str;
        default = "minimax-m2.5";
        description = "Default Pi model used by the gateway's dedicated Pi home.";
      };
      packagePaths = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [ "${config.nixpi.gateway.agentDir}/agent/local-packages/node_modules/@jarcelao/pi-exa-api" ];
        description = "Package paths written into the gateway's dedicated agent/settings.json.";
      };
      extensionPaths = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [ "${config.nixpi.gateway.agentDir}/agent/extensions/wireguard-manager.ts" ];
        description = "Extension paths written into the gateway's dedicated agent/settings.json.";
      };
      maxReplyChars = lib.mkOption {
        type = lib.types.ints.positive;
        default = 1400;
        description = "Maximum characters per gateway reply chunk.";
      };
      maxReplyChunks = lib.mkOption {
        type = lib.types.ints.positive;
        default = 4;
        description = "Maximum number of reply chunks emitted for a single Pi response.";
      };
      modules.signal = {
        enable = lib.mkOption {
          type = lib.types.bool;
          default = false;
          description = "Whether the Signal transport module is enabled under the generic gateway.";
        };
        account = lib.mkOption {
          type = lib.types.str;
          default = "";
          description = "Signal account number used by the Signal transport module, for example +15550001111.";
        };
        allowedNumbers = lib.mkOption {
          type = lib.types.listOf lib.types.str;
          default = [ ];
          description = "Phone numbers allowed to chat through the Signal transport module.";
        };
        adminNumbers = lib.mkOption {
          type = lib.types.listOf lib.types.str;
          default = [ ];
          description = "Phone numbers treated as Signal transport admins for built-in commands and future policy hooks.";
        };
        stateDir = lib.mkOption {
          type = absolutePath;
          default = "${config.nixpi.gateway.stateDir}/modules/signal";
          description = "Signal transport state root under the generic gateway state directory.";
        };
        port = lib.mkOption {
          type = lib.types.port;
          default = 8080;
          description = "Loopback HTTP port exposed by the native signal-cli daemon for the Signal transport module.";
        };
        directMessagesOnly = lib.mkOption {
          type = lib.types.bool;
          default = true;
          description = "Whether the Signal transport module accepts only direct Signal messages.";
        };
      };
    };

    piCore = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Whether the always-on Pi core local API service is enabled.";
      };
      user = lib.mkOption {
        type = lib.types.str;
        default = "nixpi-core";
        description = "System account that runs the Pi core local API service.";
      };
      group = lib.mkOption {
        type = lib.types.str;
        default = "nixpi-core";
        description = "Primary group for the Pi core service account.";
      };
      stateDir = lib.mkOption {
        type = absolutePath;
        default = "${config.nixpi.stateDir}/pi-core";
        description = "Absolute path holding Pi core runtime state.";
      };
      sessionDir = lib.mkOption {
        type = absolutePath;
        default = "${config.nixpi.piCore.stateDir}/sessions";
        description = "Directory holding Pi core session files.";
      };
      legacySessionDir = lib.mkOption {
        type = absolutePath;
        default = "${config.nixpi.gateway.stateDir}/pi-sessions";
        description = "Previous gateway-owned Pi session directory used as the source for one-time migration into Pi core.";
      };
      agentDir = lib.mkOption {
        type = absolutePath;
        default = "${config.nixpi.stateDir}/pi-core-pi";
        description = "Service-owned Pi home for the always-on Pi core service.";
      };
      legacyAgentDir = lib.mkOption {
        type = absolutePath;
        default = "${config.nixpi.gateway.agentDir}";
        description = "Previous gateway-owned Pi home used as the source for one-time migration into Pi core.";
      };
      sourceAgentDir = lib.mkOption {
        type = absolutePath;
        default = config.nixpi.agent.piDir;
        description = "Source Pi agent directory used to seed the Pi core service-owned home when no migrated copy exists yet.";
      };
      workspaceDir = lib.mkOption {
        type = absolutePath;
        default = config.nixpi.agent.workspaceDir;
        description = "Workspace path the Pi core service may access while handling prompts.";
      };
      homeTraversePath = lib.mkOption {
        type = absolutePath;
        default = "/home/${config.nixpi.primaryUser}";
        description = "Parent home path that receives execute-only ACL access so the Pi core service user can reach the configured workspace directory.";
      };
      piCwd = lib.mkOption {
        type = lib.types.str;
        default = "/home/${config.nixpi.primaryUser}";
        description = "Working directory used as the Pi SDK cwd for the Pi core service.";
      };
      defaultProvider = lib.mkOption {
        type = lib.types.str;
        default = "cortecs";
        description = "Default Pi provider used by the Pi core service-owned home.";
      };
      defaultModel = lib.mkOption {
        type = lib.types.str;
        default = "minimax-m2.5";
        description = "Default Pi model used by the Pi core service-owned home.";
      };
      packagePaths = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [ "${config.nixpi.piCore.agentDir}/agent/local-packages/node_modules/@jarcelao/pi-exa-api" ];
        description = "Package paths written into the Pi core service-owned agent/settings.json.";
      };
      extensionPaths = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [ "${config.nixpi.piCore.agentDir}/agent/extensions/wireguard-manager.ts" ];
        description = "Extension paths written into the Pi core service-owned agent/settings.json.";
      };
      socketPath = lib.mkOption {
        type = absolutePath;
        default = "/run/nixpi-pi-core/pi-core.sock";
        description = "Unix socket path exposed by the Pi core local API service.";
      };
    };

    agent = {
      autonomy = lib.mkOption {
        type = lib.types.enum [ "observe" "maintain" "admin" ];
        default = "maintain";
        description = "Default privileged autonomy level granted to the always-on agent.";
      };
      allowedUnits = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [ "nixpi-update.service" ];
        description = "Systemd units the broker may operate on.";
      };
      broker.enable = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Whether the root-owned NixPI operations broker is enabled.";
      };
      envFiles = lib.mkOption {
        type = lib.types.listOf absolutePath;
        default = [ ];
        example = [ "/var/lib/nixpi/secrets/exa.env" ];
        description = "Environment files sourced by the Pi runtime wrapper before launching pi. Use this for secrets that must stay out of the Nix store.";
      };
      elevation.duration = lib.mkOption {
        type = lib.types.str;
        default = "30m";
        description = "Default duration for a temporary admin elevation grant.";
      };
      osUpdate.enable = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Whether the broker may apply or roll back NixOS generations.";
      };
      stagedHostConfig = {
        enable = lib.mkOption {
          type = lib.types.bool;
          default = true;
          description = ''
            Whether the broker may sync a staged host-local NixOS file into the
            installed `/etc/nixos` tree and optionally rebuild immediately.
            Defaults true so hosts following the `/srv/<hostname>-private`
            mirror convention can apply staged `nixpi-host.nix` changes through
            the broker without blanket sudo.
          '';
        };
        sourceFile = lib.mkOption {
          type = absolutePath;
          default = "/srv/${config.networking.hostName}-private/nixpi-host.nix";
          description = "Absolute path to the staged host-specific NixOS file that should be synced into /etc/nixos before rebuild.";
        };
        targetFile = lib.mkOption {
          type = absolutePath;
          default = "/etc/nixos/nixpi-host.nix";
          description = "Absolute target path inside the installed host flake that receives the staged host config file.";
        };
        fileMode = lib.mkOption {
          type = lib.types.str;
          default = "0644";
          description = "File mode used when syncing the staged host config into the installed /etc/nixos tree.";
        };
      };
      packagePaths = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [ "/usr/local/share/nixpi" ];
        description = "Package root paths passed to the Pi agent settings.json packages field.";
      };
      piDir = lib.mkOption {
        type = lib.types.str;
        description = "Declarative Pi runtime directory exported as NIXPI_PI_DIR and PI_CODING_AGENT_DIR.";
      };
      workspaceDir = lib.mkOption {
        type = lib.types.str;
        description = "Root directory for the Pi agent workspace (Objects, Episodes, Skills, Persona, etc.).";
      };
    };
  };

  config = {
    nixpi.bootstrap.ssh.enable = lib.mkDefault true;
    nixpi.bootstrap.temporaryAdmin.enable = lib.mkDefault cfg.enable;
    nixpi.agent.piDir = lib.mkDefault "/home/${config.nixpi.primaryUser}/.pi";
    nixpi.agent.workspaceDir = lib.mkDefault "/home/${config.nixpi.primaryUser}/nixpi";
    nixpi.gateway.enable = lib.mkDefault config.nixpi.gateway.modules.signal.enable;
    nixpi.piCore.enable = lib.mkDefault config.nixpi.gateway.enable;
    nixpi.integrations.exa.envFile = lib.mkDefault "${config.nixpi.stateDir}/secrets/exa.env";
    nixpi.agent.envFiles = lib.mkIf config.nixpi.integrations.exa.enable (
      lib.mkBefore [ config.nixpi.integrations.exa.envFile ]
    );
  };
}
