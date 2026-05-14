{
  description = "Nazar NixOS MicroVM fleet";

  nixConfig = {
    extra-substituters = [ "https://cache.numtide.com" ];
    extra-trusted-public-keys = [ "niks3.numtide.com-1:DTx8wZduET09hRmMtKdQDxNNthLQETkc/yaX7M4qK0g=" ];
  };

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

    # Keep llm-agents on its pinned nixpkgs so Numtide's binary cache hits and
    # agent packages do not need to rebuild against the fleet nixpkgs input.
    llm-agents.url = "github:numtide/llm-agents.nix";

    disko = {
      url = "github:nix-community/disko";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    microvm = {
      url = "github:astro/microvm.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    minecraft = {
      url = "git+ssh://alex@git.nazar.studio/nazar/minecraft.git";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    dav-server = {
      url = "git+ssh://alex@git.nazar.studio/nazar/dav-server.git";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    nixpi = {
      url = "git+ssh://alex@git.nazar.studio/nazar/nixpi.git";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    inputs@{
      self,
      nixpkgs,
      disko,
      ...
    }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      pi = pkgs.callPackage ./nix/packages/pi { };
      fleet = import ./nix/fleet/vms.nix;

    in
    {
      nixosModules = {
        dav-server-identity = ./nix/modules/services/dav-server-identity.nix;
        microvm-guest = ./nix/modules/host/microvm-guest.nix;
        microvm-host = ./nix/modules/host/microvm-host.nix;
        host-git-ssh = ./nix/modules/host/git-ssh.nix;
      };

      nixosConfigurations = {
        nazar = nixpkgs.lib.nixosSystem {
          inherit system;
          specialArgs = {
            inherit inputs fleet;
          };
          modules = [
            disko.nixosModules.disko
            ./nix/hosts/nazar
          ];
        };

        alex-laptop = nixpkgs.lib.nixosSystem {
          inherit system;
          specialArgs = {
            inherit inputs fleet;
          };
          modules = [ ./nix/hosts/alex-laptop ];
        };
      };

      packages.${system} = {
        inherit pi;
      };

      apps.${system} =
        let
          switchNodeNames = nixpkgs.lib.attrNames fleet.vms;
          switchNodeList = nixpkgs.lib.concatStringsSep " " switchNodeNames;
          mkSwitchProgram =
            name: nodes:
            let
              nodeList = nixpkgs.lib.concatStringsSep " " nodes;
            in
            pkgs.writeShellApplication {
              name = "nazar-switch-${name}";
              runtimeInputs = [
                pkgs.nixos-rebuild
                pkgs.systemd
              ];
              text = ''
                set -euo pipefail

                if [ "$EUID" -ne 0 ]; then
                  exec sudo "$0" "$@"
                fi

                nixos-rebuild switch --flake ${self.outPath}#nazar "$@"

                ${nixpkgs.lib.optionalString (nodes != [ ]) ''
                  for node in ${nodeList}; do
                    echo "==> restarting MicroVM $node"
                    systemctl restart "microvm@$node.service"
                    systemctl is-active --quiet "microvm@$node.service"
                  done
                ''}
              '';
            };
          mkSwitchApp = name: {
            type = "app";
            program = "${mkSwitchProgram name [ name ]}/bin/nazar-switch-${name}";
            meta.description = "Switch the Nazar host configuration and restart the ${name} MicroVM";
          };
          switchFleetApp = {
            type = "app";
            program = "${mkSwitchProgram "fleet" switchNodeNames}/bin/nazar-switch-fleet";
            meta.description = "Switch the Nazar host configuration and restart the MicroVM fleet: ${switchNodeList}";
          };
        in
        {
          default = switchFleetApp;
          switch = switchFleetApp;
          switch-fleet = switchFleetApp;
          switch-host = {
            type = "app";
            program = "${mkSwitchProgram "host" [ ]}/bin/nazar-switch-host";
            meta.description = "Switch only the Nazar host configuration";
          };
          switch-minecraft = mkSwitchApp "minecraft";
          switch-dav-server = mkSwitchApp "dav-server";
        };

      checks.${system} = { };

      devShells.${system}.default = pkgs.mkShell {
        packages = [ pkgs.nixos-rebuild ];
      };

      formatter.${system} = pkgs.writeShellApplication {
        name = "nazar-fmt";
        runtimeInputs = [
          pkgs.findutils
          pkgs.nixfmt
        ];
        text = ''
          find flake.nix nix -type f -name '*.nix' -print0             | xargs -0 --no-run-if-empty nixfmt
        '';
      };
    };
}
