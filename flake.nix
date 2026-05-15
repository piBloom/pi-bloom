{
  description = "NixPi Bun web interface for Pi Coding Agent";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems f;
    in
    {
      overlays.default = final: _prev: {
        nixpi-bun = final.callPackage ./nix/packages/nixpi-bun { };
      };

      packages = forAllSystems (system:
        let
          pkgs = import nixpkgs {
            inherit system;
            overlays = [ self.overlays.default ];
          };
        in
        {
          inherit (pkgs) nixpi-bun;
          default = pkgs.nixpi-bun;
        });

      nixosModules = rec {
        nixpi-bun = ./nix/modules/nixpi-bun.nix;
        default = nixpi-bun;
      };

      devShells = forAllSystems (system:
        let
          pkgs = import nixpkgs { inherit system; };
        in
        {
          default = pkgs.mkShell {
            packages = [ pkgs.bun pkgs.nodejs_22 ];
          };
        });

      checks = forAllSystems (system: {
        inherit (self.packages.${system}) nixpi-bun;
      });
    };
}
