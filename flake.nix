# flake.nix
{
  description = "NixPI — Pi-native AI companion OS on NixOS";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    nixpkgs-stable.url = "github:NixOS/nixpkgs/nixos-25.11";
    disko.url = "github:nix-community/disko";
    disko.inputs.nixpkgs.follows = "nixpkgs-stable";
    nixos-anywhere.url = "github:nix-community/nixos-anywhere";
    nixos-anywhere.inputs.nixpkgs.follows = "nixpkgs-stable";
  };

  outputs =
    {
      self,
      nixpkgs,
      nixpkgs-stable,
      disko,
      nixos-anywhere,
      ...
    }:
    let
      system = "x86_64-linux";
      inherit (nixpkgs) lib;
      supportedSystems = [
        system
        "aarch64-linux"
      ];
      forAllSystems = lib.genAttrs supportedSystems;
      mkPkgs = system: import nixpkgs { inherit system; };
      pkgs = mkPkgs system;
      # pkgsUnfree is used only for nixosTest. pkgs.testers.nixosTest injects its
      # own pkgs as nixpkgs.pkgs for test nodes, which means modules cannot set
      # nixpkgs.config (NixOS assertion). Using a pkgs already created with
      # allowUnfree = true sidesteps the issue without touching any module.
      pkgsUnfree = import nixpkgs {
        inherit system;
        config.allowUnfree = true;
      };
      mkPackages = import ./nix/pkgs.nix { inherit self nixpkgs nixos-anywhere; };
    in
    {
      packages = forAllSystems mkPackages;

      formatter = forAllSystems (system: (mkPkgs system).nixfmt-rfc-style);

      nixosModules = {
        # Single composable module exporting all NixPI feature modules.
        # Use enable flags (nixpi.app.enable, nixpi.shell.enable, etc.) to
        # activate only what a given configuration needs.
        nixpi =
          { ... }:
          {
            imports = [
              ./core/os/modules/options.nix
              ./core/os/modules/network.nix
              ./core/os/modules/update.nix
              ./core/os/modules/app.nix
              ./core/os/modules/broker.nix
              ./core/os/modules/tooling.nix
              ./core/os/modules/shell.nix
            ];
          };
      };

      nixosConfigurations = import ./nix/hosts.nix {
        inherit self nixpkgs nixpkgs-stable disko system;
      };

      checks.${system} = import ./nix/checks.nix {
        inherit self pkgs pkgsUnfree lib system;
      };

      apps.${system} = {
        nixpi-bootstrap-host = {
          type = "app";
          program = "${self.packages.${system}.nixpi-bootstrap-host}/bin/nixpi-bootstrap-host";
        };
      } // lib.optionalAttrs (self.packages.${system} ? plain-host-deploy) {
        plain-host-deploy = {
          type = "app";
          program = "${self.packages.${system}.plain-host-deploy}/bin/plain-host-deploy";
        };
      };

      devShells = forAllSystems (
        system:
        let
          pkgs = mkPkgs system;
        in
        {
          default = pkgs.mkShell {
            packages = with pkgs; [
              # JavaScript / TypeScript
              nodejs
              typescript
              biome

              # Linting & utilities
              nixfmt-rfc-style
              statix
              shellcheck
              jq
              curl
              git
              just
            ];

            # Note: vitest is not in nixpkgs-unstable — use 'npm install' then 'npx vitest'

            shellHook = ''
              echo "NixPI dev shell"
              echo "Run 'npm install' to set up JS dependencies (includes vitest)"
            '';
          };
        }
      );
    };
}
