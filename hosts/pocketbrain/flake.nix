{
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";
  inputs.nixpi.url = "github:alexradunet/nixpi";
  inputs.nixpi.inputs.nixpkgs.follows = "nixpkgs";

  outputs = { nixpkgs, nixpi, ... }: {
    nixosConfigurations.nixos = nixpkgs.lib.nixosSystem {
      system = builtins.currentSystem;
      specialArgs = { inherit nixpi; };
      modules = [
        ./configuration.nix
        ./nixpi-integration.nix
        ./hardware-configuration.nix
      ];
    };
  };
}
