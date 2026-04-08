# core/os/modules/options.nix
# Aggregates NixPI option declarations split by concern.
{ lib, ... }:

{
  imports = [
    ./options/core.nix
    ./options/security.nix
    ./options/agent.nix
    ./options/wireguard.nix
    ./options/terminal-ui.nix
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

    install = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = ''
          Whether the installed system should seed the canonical /srv/nixpi checkout
          and initialize /etc/nixos/flake.nix on first boot.
        '';
      };

      repoUrl = lib.mkOption {
        type = lib.types.str;
        default = "https://github.com/alexradunet/nixpi.git";
        description = ''
          Git repository used to seed /srv/nixpi on first boot.
        '';
      };

      repoBranch = lib.mkOption {
        type = lib.types.str;
        default = "main";
        description = ''
          Branch used when cloning the canonical /srv/nixpi checkout.
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
  };
}
