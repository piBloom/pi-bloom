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
    nixpi.integrations.exa.envFile = lib.mkDefault "${config.nixpi.stateDir}/secrets/exa.env";
    nixpi.agent.envFiles = lib.mkIf config.nixpi.integrations.exa.enable (
      lib.mkBefore [ config.nixpi.integrations.exa.envFile ]
    );
  };
}
