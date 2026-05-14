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
      mkNixosHost = import ./nix/lib/mk-nixos-host.nix {
        inherit
          inputs
          nixpkgs
          system
          fleet
          ;
      };

      microvmGuestBaseModules = [
        inputs.microvm.nixosModules.microvm
        ./nix/modules/common/base.nix
        ./nix/modules/common/users.nix
        ./nix/modules/common/security.nix
        ./nix/modules/common/development.nix
        ./nix/modules/common/nazar-context.nix
        ./nix/modules/host/microvm-guest.nix
      ];

      piAgentModule = ./nix/modules/common/pi-agent.nix;

      microvmServiceModules = {
        minecraft = [
          ./nix/modules/services/minecraft-identity.nix
          inputs.minecraft.nixosModules.minecraft-service
        ];
        dav-server = [ ./nix/modules/services/dav-server.nix ];
      };

      mkMicrovmGuest = name:
        mkNixosHost {
          inherit name;
          vm = fleet.vms.${name};
          modules = microvmGuestBaseModules
            ++ nixpkgs.lib.optional (fleet.vms.${name}.piAgent.enable or false) piAgentModule
            ++ microvmServiceModules.${name};
        };
    in
    {
      nixosModules = {
        dav-server-service = ./nix/modules/services/dav-server.nix;
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

        minecraft = mkMicrovmGuest "minecraft";
        "dav-server" = mkMicrovmGuest "dav-server";
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
