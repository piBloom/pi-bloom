# core/os/modules/options.nix
# Shared NixOS options consumed across NixPI modules.
{ lib, ... }:

let
  absolutePath = lib.types.pathWith { absolute = true; };
  # Absolute path that must not be a Nix store path (user-managed external state).
  externalAbsolutePath = lib.types.externalPath;
  mkPortOption = default: description:
    lib.mkOption {
      type = lib.types.port;
      inherit default description;
    };
in
{
  options.nixpi = {
    primaryUser = lib.mkOption {
      type = lib.types.str;
      default = "pi";
      description = ''
        Primary human/operator account for the NixPI machine.
      '';
    };

    stateDir = lib.mkOption {
      type = absolutePath;
      default = "/var/lib/nixpi";
      description = ''
        Root directory for service-owned NixPI state.
      '';
    };

    security = {
      fail2ban.enable = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = ''
          Whether fail2ban should protect SSH against brute-force attempts.
        '';
      };

      ssh.passwordAuthentication = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = ''
          Whether SSH password authentication is enabled for the main NixPI
          host configuration.
        '';
      };

      ssh.allowUsers = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [ ];
        description = ''
          Explicit SSH login allowlist. When empty, NixPI restricts SSH to the
          resolved primary operator account when one is available.
        '';
      };

      trustedInterface = lib.mkOption {
        type = lib.types.str;
        default = "wt0";
        description = ''
          Network interface trusted to reach the externally exposed NixPI
          service surface.
        '';
      };

      enforceServiceFirewall = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = ''
          Whether NixPI service ports are opened only on the trusted interface.
        '';
      };

      passwordlessSudo.enable = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = ''
          Deprecated blanket passwordless sudo escape hatch. Keep disabled in
          favor of narrow bootstrap rules and the broker service.
        '';
      };
    };

    bootstrap = {
      keepSshAfterSetup = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = ''
          Whether SSH should remain reachable after first-boot setup
          completes. By default SSH is treated as a bootstrap-only path.
        '';
      };

      passwordlessSudo.enable = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = ''
          Whether NixPI grants narrow passwordless sudo rules needed by the
          first-boot bootstrap flow.
        '';
      };
    };

    agent = {
      autonomy = lib.mkOption {
        type = lib.types.enum [ "observe" "maintain" "admin" ];
        default = "maintain";
        description = ''
          Default privileged autonomy level granted to the always-on agent.
        '';
      };

      allowedUnits = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [
          "nixpi-daemon.service"
          "netbird.service"
          "nixpi-home.service"
          "nixpi-element-web.service"
          "continuwuity.service"
          "nixpi-update.service"
        ];
        description = ''
          Systemd units that the broker may operate on.
        '';
      };

      broker.enable = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = ''
          Whether the root-owned NixPI operations broker is enabled.
        '';
      };

      elevation.duration = lib.mkOption {
        type = lib.types.str;
        default = "30m";
        description = ''
          Default duration for a temporary admin elevation grant.
        '';
      };

      osUpdate.enable = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = ''
          Whether the broker may apply or roll back NixOS generations.
        '';
      };
    };

    services = {
      bindAddress = lib.mkOption {
        type = lib.types.str;
        default = "0.0.0.0";
        description = ''
          Bind address used by the built-in NixPI service surface.
        '';
      };

      home = {
        enable = lib.mkEnableOption "NixPI Home service" // { default = true; };
        port = mkPortOption 8080 "TCP port for the NixPI Home landing page.";
      };

      elementWeb = {
        enable = lib.mkEnableOption "NixPI Element Web service" // { default = true; };
        port = mkPortOption 8081 "TCP port for the NixPI Element Web client.";
      };
    };

    matrix = {
      bindAddress = lib.mkOption {
        type = lib.types.str;
        default = "0.0.0.0";
        description = ''
          Bind address used by the local Matrix homeserver listener.
        '';
      };

      port = mkPortOption 6167 "TCP port for the local Matrix homeserver.";

      clientBaseUrl = lib.mkOption {
        type = lib.types.str;
        default = "";
        description = ''
          Client-facing Matrix base URL used by Element Web and advertised to
          operators. When left empty, NixPI derives it from the hostname and
          configured Matrix port.
        '';
      };

      enableRegistration = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = ''
          Whether Matrix account registration is enabled.
        '';
      };

      keepRegistrationAfterSetup = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = ''
          Whether Matrix account registration should remain enabled after the
          first-boot setup completes.
        '';
      };

      maxUploadSize = lib.mkOption {
        type = lib.types.str;
        default = "20M";
        description = ''
          Maximum upload size accepted by the local Matrix homeserver.
        '';
      };

      registrationSharedSecretFile = lib.mkOption {
        type = lib.types.nullOr externalAbsolutePath;
        default = null;
        description = ''
          Optional external file containing the Matrix registration secret
          maintained for NixPI bootstrap compatibility. When unset, NixPI
          generates one stable runtime secret file.
        '';
      };

      macaroonSecretKeyFile = lib.mkOption {
        type = lib.types.nullOr externalAbsolutePath;
        default = null;
        description = ''
          Deprecated Synapse-era option. Continuwuity does not use a macaroon
          secret key, so this value is ignored.
        '';
      };
    };

    update = {
      onBootSec = lib.mkOption {
        type = lib.types.str;
        default = "5min";
        description = ''
          Delay before the first automatic update check after boot.
        '';
      };

      interval = lib.mkOption {
        type = lib.types.str;
        default = "6h";
        description = ''
          Recurrence interval for the automatic update timer.
        '';
      };
    };

    timezone = lib.mkOption {
      type = lib.types.str;
      default = "UTC";
      description = ''
        System timezone. Any valid IANA timezone string (e.g. "Europe/Paris").
        Set interactively by the first-boot setup wizard.
      '';
    };

    keyboard = lib.mkOption {
      type = lib.types.str;
      default = "us";
      description = ''
        Console and X keyboard layout (e.g. "fr", "de", "us").
        Set interactively by the first-boot setup wizard.
      '';
    };
  };
}
