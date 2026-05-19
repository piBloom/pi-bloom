{
  description = "Nazar Proxmox-hosted NixOS infrastructure guests";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";
    nixos-generators.url = "github:nix-community/nixos-generators";
    nixos-generators.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = { self, nixpkgs, nixos-generators, ... }:
    let
      system = "x86_64-linux";
      lib = nixpkgs.lib;
    in
    {
      nixosConfigurations = {
        edge = lib.nixosSystem {
          inherit system;
          modules = [
            ./hosts/edge/configuration.nix
          ];
        };
      };

      packages.${system} = {
        edge-qcow = nixos-generators.nixosGenerate {
          inherit system;
          format = "qcow";
          modules = [
            ./hosts/edge/configuration.nix
            ./modules/proxmox-image.nix
          ];
        };
      };

      checks.${system}.edge-toplevel = self.nixosConfigurations.edge.config.system.build.toplevel;
    };
}
