{
  description = "Nazar Proxmox NixOS VM fleet";

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

    forgejo = {
      url = "git+ssh://git@git.nazar.studio:10022/nazar/forgejo.git";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    minecraft = {
      url = "git+ssh://git@git.nazar.studio:10022/nazar/minecraft.git";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    ownloom = {
      url = "git+ssh://git@git.nazar.studio:10022/nazar/ownloom.git";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    "ownloom-data" = {
      url = "git+ssh://git@git.nazar.studio:10022/nazar/ownloom-data.git";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    inputs@{
      self,
      nixpkgs,
      disko,
      microvm,
      sops-nix,
      deploy-rs,
      ...
    }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      fleet = import ./nix/fleet/vms.nix;
      mkNixosHost = import ./nix/lib/mk-nixos-host.nix {
        inherit
          inputs
          nixpkgs
          system
          fleet
          ;
      };

      commonVmModules = [
        ./nix/modules/common/base.nix
        ./nix/modules/common/users.nix
        ./nix/modules/common/security.nix
        ./nix/modules/common/networking.nix
        ./nix/modules/common/netbird.nix
        ./nix/modules/common/sops.nix
        ./nix/modules/common/nazar-context.nix
      ];

      piVmModules = [ ./nix/modules/common/pi-agent.nix ];

      mkExternalVm =
        {
          name,
          module,
          includeProxmox ? false,
          includePi ? true,
        }:
        mkNixosHost {
          inherit name;
          vm = fleet.vms.${name};
          modules = [
            disko.nixosModules.disko
            sops-nix.nixosModules.sops
          ]
          ++ commonVmModules
          ++ nixpkgs.lib.optionals includeProxmox [ ./nix/modules/common/proxmox-guest.nix ]
          ++ nixpkgs.lib.optionals includePi piVmModules
          ++ [ module ];
        };

      mkExternalImage =
        {
          name,
          module,
          includePi ? true,
        }:
        mkNixosHost {
          inherit name;
          vm = fleet.vms.${name};
          modules = [
            "${nixpkgs}/nixos/modules/virtualisation/disk-image.nix"
            sops-nix.nixosModules.sops
          ]
          ++ commonVmModules
          ++ nixpkgs.lib.optionals includePi piVmModules
          ++ [ module ];
        };
    in
    {
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

        git = mkExternalVm {
          name = "git";
          module = inputs.forgejo.nixosModules.forgejo;
          includeProxmox = true;
        };

        gitImage = mkExternalImage {
          name = "git";
          module = inputs.forgejo.nixosModules.forgejo-image;
        };

        minecraft = mkExternalVm {
          name = "minecraft";
          module = inputs.minecraft.nixosModules.minecraft;
        };

        minecraftImage = mkExternalImage {
          name = "minecraft";
          module = inputs.minecraft.nixosModules.minecraft-image;
        };

        ownloom = mkExternalVm {
          name = "ownloom";
          module = inputs.ownloom.nixosModules.ownloom;
          includeProxmox = true;
          includePi = false;
        };

        ownloomImage = mkExternalImage {
          name = "ownloom";
          module = inputs.ownloom.nixosModules.ownloom-image;
          includePi = false;
        };

        ownloom-data = mkExternalVm {
          name = "ownloom-data";
          module = inputs."ownloom-data".nixosModules.ownloom-data;
          includeProxmox = true;
        };

        ownloomDataImage = mkExternalImage {
          name = "ownloom-data";
          module = inputs."ownloom-data".nixosModules.ownloom-data-image;
        };
      };

      packages.${system} = {
        git-qcow2 = self.nixosConfigurations.gitImage.config.system.build.image;
        minecraft-qcow2 = self.nixosConfigurations.minecraftImage.config.system.build.image;
        ownloom-qcow2 = self.nixosConfigurations.ownloomImage.config.system.build.image;
        ownloom-data-qcow2 = self.nixosConfigurations.ownloomDataImage.config.system.build.image;
        ownloom-web = inputs.ownloom.packages.${system}.ownloom-web;
      };

      deploy.nodes = nixpkgs.lib.mapAttrs (name: vm: {
        # Deploy from the Proxmox host `nazar` over vmbr1 private NAT aliases.
        # `alex` is the canonical VM admin user; deploy-rs escalates to the
        # root system profile through passwordless sudo declared in common users.
        hostname = vm.hostname;
        fastConnection = true;
        remoteBuild = false;
        profiles.system = {
          sshUser = "alex";
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
            meta.description = "Deploy the ${name} NixOS VM from nazar with deploy-rs";
          };
        in
        {
          deploy = {
            type = "app";
            program = deployBin;
            meta.description = "Run deploy-rs for the nazar NixOS VM fleet";
          };
          deploy-git = mkDeployApp "git";
          deploy-minecraft = mkDeployApp "minecraft";
          deploy-ownloom = mkDeployApp "ownloom";
          deploy-ownloom-data = mkDeployApp "ownloom-data";
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
            meta.description = "Deploy all current NixOS VMs from nazar with deploy-rs";
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
          find flake.nix nix -type f -name '*.nix' -print0 \
            | xargs -0 --no-run-if-empty nixfmt
        '';
      };
    };
}
