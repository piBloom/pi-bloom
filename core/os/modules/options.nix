# core/os/modules/options.nix
# Aggregates NixPI option declarations split by concern.
{ lib, ... }:

let
  installFinalizeRemoved = ''
    nixpi.install.* was removed. Install the final host configuration directly
    with nixos-anywhere; NixPI no longer seeds /srv/nixpi or generates
    /etc/nixos/flake.nix at boot.
  '';
  netbirdRemoved = ''
    nixpi.netbird.* was removed. NixPI no longer manages NetBird as part of the
    host security model. Remove the old NetBird settings and use
    nixpi.security.ssh.allowedSourceCIDRs to restrict public SSH access.
  '';
in
{
  imports = [
    ./options/core.nix
    ./options/bootstrap.nix
    ./options/security.nix
    ./options/agent.nix
    (lib.mkRenamedOptionModule [ "nixpi" "bootstrap" "keepSshAfterSetup" ] [ "nixpi" "bootstrap" "ssh" "enable" ])
    (lib.mkRemovedOptionModule [ "nixpi" "install" "enable" ] installFinalizeRemoved)
    (lib.mkRemovedOptionModule [ "nixpi" "install" "repoUrl" ] installFinalizeRemoved)
    (lib.mkRemovedOptionModule [ "nixpi" "install" "repoBranch" ] installFinalizeRemoved)
    (lib.mkRemovedOptionModule [ "nixpi" "netbird" "enable" ] netbirdRemoved)
    (lib.mkRemovedOptionModule [ "nixpi" "netbird" "setupKeyFile" ] netbirdRemoved)
    (lib.mkRemovedOptionModule [ "nixpi" "netbird" "clientName" ] netbirdRemoved)
    (lib.mkRemovedOptionModule [ "nixpi" "netbird" "managementUrl" ] netbirdRemoved)
  ];

  options.nixpi = {
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
