# core/os/modules/options.nix
# Aggregates NixPI option declarations split by concern.
{ lib, ... }:

let
  mkPortOption =
    default: description:
    lib.mkOption {
      type = lib.types.port;
      inherit default description;
    };
in
{
  imports = [
    ./options/core.nix
    ./options/security.nix
    ./options/agent.nix
    ./options/wireguard.nix
  ];

  options.nixpi = {
    bootstrap.keepSshAfterSetup = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = ''
        Whether SSH should remain reachable after first-boot setup
        completes. By default SSH is treated as a bootstrap-only path.
      '';
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

    services = {
      bindAddress = lib.mkOption {
        type = lib.types.str;
        default = "0.0.0.0";
        description = ''
          Bind address used by the built-in NixPI service surface.
        '';
      };

      home = {
        enable = lib.mkEnableOption "NixPI Chat service" // {
          default = true;
        };
        port = mkPortOption 8080 "TCP port for the NixPI Chat server.";
      };

      secureWeb = {
        enable = lib.mkEnableOption "canonical HTTPS gateway for NixPI Chat" // {
          default = true;
        };
        port = mkPortOption 443 "TCP port for the canonical HTTPS NixPI entry point.";
      };
    };
  };
}
