# nix/hosts.nix — nixosConfigurations
{ self, nixpkgs, nixpkgs-stable, disko, system }:
let
  mkConfiguredSystem =
    { system, modules }:
    nixpkgs.lib.nixosSystem {
      inherit system;
      modules = modules ++ [
        {
          nixpkgs.hostPlatform = system;
          nixpkgs.config.allowUnfree = true;
        }
      ];
    };
  mkConfiguredStableSystem =
    { system, modules }:
    nixpkgs-stable.lib.nixosSystem {
      inherit system;
      modules = modules ++ [
        {
          nixpkgs.hostPlatform = system;
          nixpkgs.config.allowUnfree = true;
        }
      ];
    };
in
{
  # Canonical NixPI headless VPS profile used for local builds and CI topology checks.
  vps = mkConfiguredSystem {
    inherit system;
    modules = [
      ../core/os/hosts/vps.nix
      {
        nixpi.security.ssh.allowedSourceCIDRs = [ "192.0.2.10/32" ];
      }
    ];
  };

  # Representative installed NixPI system used by checks.config and checks.boot.
  installed-test = mkConfiguredSystem {
    inherit system;
    modules = [
      self.nixosModules.nixpi
      {
        nixpi.primaryUser = "alex";
        nixpi.security.ssh.allowedSourceCIDRs = [ "192.0.2.10/32" ];
        networking.hostName = "nixos";
        system.stateVersion = "25.05";
        boot.loader = {
          systemd-boot.enable = true;
          efi.canTouchEfiVariables = true;
        };
        fileSystems = {
          "/" = {
            device = "/dev/vda";
            fsType = "ext4";
          };
          "/boot" = {
            device = "/dev/vda1";
            fsType = "vfat";
          };
        };
      }
    ];
  };
}
// nixpkgs.lib.optionalAttrs (
  builtins.pathExists ../nixos_vps_provisioner/presets/ovh-single-disk.nix
  && builtins.pathExists ../nixos_vps_provisioner/presets/ovh-vps-base.nix
) {
  ovh-vps-base = mkConfiguredStableSystem {
    inherit system;
    modules = [
      disko.nixosModules.disko
      ../nixos_vps_provisioner/presets/ovh-single-disk.nix
      ../nixos_vps_provisioner/presets/ovh-vps-base.nix
    ];
  };
}
