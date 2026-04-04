# core/os/modules/setup-apply.nix
# Installs nixpi-setup-apply system-wide and grants the primary user
# passwordless sudo access to it. Called by the web wizard backend.
{ pkgs, lib, config, setupApplyPackage, ... }:

let
  primaryUser = config.nixpi.primaryUser;
in
{
  environment.systemPackages = [ setupApplyPackage ];

  security.sudo.extraRules = [
    {
      users = [ primaryUser ];
      commands = [
        {
          command = "${setupApplyPackage}/bin/nixpi-setup-apply";
          options = [ "NOPASSWD" ];
        }
      ];
    }
  ];
}
