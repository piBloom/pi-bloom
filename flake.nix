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

    sops-nix = {
      url = "github:Mic92/sops-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    deploy-rs = {
      url = "github:serokell/deploy-rs";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    minecraft = {
      url = "git+ssh://git@git.nazar.studio:10022/nazar/minecraft.git";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    nixpi = {
      url = "git+ssh://git@git.nazar.studio:10022/nazar/nixpi.git";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    inputs@{
      self,
      nixpkgs,
      disko,
      sops-nix,
      deploy-rs,
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
        sops-nix.nixosModules.sops
        ./nix/modules/common/base.nix
        ./nix/modules/common/users.nix
        ./nix/modules/common/security.nix
        ./nix/modules/common/development.nix
        ./nix/modules/common/sops.nix
        ./nix/modules/common/nazar-context.nix
        ./nix/modules/common/git-ssh.nix
        ./nix/modules/host/microvm-guest.nix
      ];

      piAgentModule = ./nix/modules/common/pi-agent.nix;

      microvmServiceModules = {
        git = [
          ./nix/modules/services/forgejo.nix
          ./nix/modules/services/forgejo-bootstrap.nix
        ];
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
        forgejo-service = ./nix/modules/services/forgejo.nix;
        forgejo-bootstrap = ./nix/modules/services/forgejo-bootstrap.nix;
        dav-server-service = ./nix/modules/services/dav-server.nix;
        git-ssh = ./nix/modules/common/git-ssh.nix;
        microvm-guest = ./nix/modules/host/microvm-guest.nix;
        microvm-host = ./nix/modules/host/microvm-host.nix;
      };

      nixosConfigurations = {
        nazar = nixpkgs.lib.nixosSystem {
          inherit system;
          specialArgs = {
            inherit inputs fleet;
          };
          modules = [
            disko.nixosModules.disko
            sops-nix.nixosModules.sops
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

        git = mkMicrovmGuest "git";
        minecraft = mkMicrovmGuest "minecraft";
        "dav-server" = mkMicrovmGuest "dav-server";
      };

      packages.${system} = {
        inherit pi;
      };

      deploy.nodes = nixpkgs.lib.mapAttrs (name: vm: {
        # Deploy over private MicroVM aliases from the Nazar orchestrator.
        # Use root for deploy-rs store copies/activation; root SSH is key-only
        # and trusted only from the declarative Nazar host/admin key set.
        hostname = vm.hostname;
        fastConnection = true;
        remoteBuild = false;
        profiles.system = {
          sshUser = "root";
          user = "root";
          path = deploy-rs.lib.${system}.activate.nixos self.nixosConfigurations.${name};
        };
      }) fleet.vms;

      apps.${system} =
        let
          deployBin = "${deploy-rs.packages.${system}.deploy-rs}/bin/deploy";
          deployNodeNames = nixpkgs.lib.attrNames fleet.vms;
          deployNodeList = nixpkgs.lib.concatStringsSep " " deployNodeNames;
          mkDeployApp = name: {
            type = "app";
            program = toString (
              pkgs.writeShellScript "nazar-deploy-${name}" ''
                exec ${deployBin} "$@" "${self.outPath}#${name}"
              ''
            );
            meta.description = "Deploy the ${name} NixOS MicroVM from nazar with deploy-rs";
          };
        in
        {
          deploy = {
            type = "app";
            program = deployBin;
            meta.description = "Run deploy-rs for the nazar NixOS MicroVM fleet";
          };
          deploy-git = mkDeployApp "git";
          deploy-minecraft = mkDeployApp "minecraft";
          deploy-dav-server = mkDeployApp "dav-server";
          deploy-all = {
            type = "app";
            program = toString (
              pkgs.writeShellScript "nazar-deploy-all" ''
                set -euo pipefail
                if [ "''${NAZAR_DEPLOY_ALL_CONFIRM:-}" != "yes" ]; then
                  echo "Refusing all-fleet deploy without NAZAR_DEPLOY_ALL_CONFIRM=yes." >&2
                  echo "Deploy one canary first, validate it, then rerun with the confirmation variable." >&2
                  exit 2
                fi

                for node in ${deployNodeList}; do
                  echo "==> deploying $node"
                  ${deployBin} "$@" "${self.outPath}#$node"
                done
              ''
            );
            meta.description = "Deploy all current NixOS MicroVMs from nazar with deploy-rs";
          };
        };

      checks.${system} = deploy-rs.lib.${system}.deployChecks self.deploy;

      devShells.${system}.default = pkgs.mkShell {
        packages = [ deploy-rs.packages.${system}.deploy-rs ];
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
