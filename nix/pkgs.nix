# nix/pkgs.nix — mkPackages: system → NixPI package attrset
{ self, nixpkgs, nixos-anywhere }:
system:
let
  pkgs = import nixpkgs { inherit system; };
  piAgent = pkgs.callPackage ../core/os/pkgs/pi { };
  appPackage = pkgs.callPackage ../core/os/pkgs/app { inherit piAgent; };
  nixpiBootstrapDefaultInput =
    if self ? rev then
      "github:alexradunet/nixpi/${self.rev}"
    else
      "github:alexradunet/nixpi";
in
{
  pi = piAgent;
  app = appPackage;
  # Guardrail contract reference: nixpi-bootstrap-host = pkgs.callPackage ../core/os/pkgs/nixpi-bootstrap-host { };
  nixpi-bootstrap-host = pkgs.callPackage ../core/os/pkgs/nixpi-bootstrap-host {
    nixpiDefaultInput = nixpiBootstrapDefaultInput;
  };
  nixpi-rebuild = pkgs.callPackage ../core/os/pkgs/nixpi-rebuild { };
}
// pkgs.lib.optionalAttrs (builtins.pathExists ../nixos_vps_provisioner/pkgs/plain-host-deploy) {
  plain-host-deploy = pkgs.callPackage ../nixos_vps_provisioner/pkgs/plain-host-deploy {
    nixosAnywherePackage = nixos-anywhere.packages.${system}.nixos-anywhere;
  };
}
