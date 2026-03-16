# flake.nix
{
  description = "Bloom OS — Pi-native AI companion OS on NixOS";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    nixos-generators = {
      url = "github:nix-community/nixos-generators";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    disko = {
      url = "github:nix-community/disko";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    llm-agents-nix = {
      url = "github:numtide/llm-agents.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, nixos-generators, disko, llm-agents-nix, ... }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      piAgent = llm-agents-nix.packages.${system}.pi;
      bloomApp = pkgs.callPackage ./core/os/pkgs/bloom-app { inherit piAgent; };
    in {
      packages.${system} = {
        bloom-app = bloomApp;
      };

      nixosConfigurations.bloom-x86_64 = nixpkgs.lib.nixosSystem {
        inherit system;
        modules = [
          disko.nixosModules.disko
          ./core/os/hosts/x86_64.nix
        ];
        specialArgs = { inherit piAgent bloomApp; };
      };
    };
}
