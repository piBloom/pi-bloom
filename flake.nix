{
  description = "Nazar NixOS VM fleet";

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

      commonVmModules = [
        ./nix/modules/common/base.nix
        ./nix/modules/common/users.nix
        ./nix/modules/common/security.nix
        ./nix/modules/common/networking.nix
        ./nix/modules/common/development.nix
        ./nix/modules/common/sops.nix
        ./nix/modules/common/nazar-context.nix
      ];

      agentVmModules = [ ./nix/modules/common/pi-agent.nix ];

      forgejoServiceModules = [
        ./nix/modules/services/forgejo.nix
        ./nix/modules/services/forgejo-bootstrap.nix
      ];

      forgejoStandaloneModule =
        { lib, ... }:
        {
          imports = forgejoServiceModules;

          # VM 101 is deployed from the generated qcow2 image on a single legacy-BIOS
          # VirtIO disk. Keep the normal rebuild/deploy target aligned with that
          # installed shape so deploy-rs can switch it without expecting an EFI /boot.
          boot.loader.systemd-boot.enable = lib.mkForce false;
          boot.loader.efi.canTouchEfiVariables = lib.mkForce false;
          boot.loader.grub = {
            enable = true;
            device = "/dev/vda";
          };
          boot.growPartition = true;
          boot.kernelParams = [ "console=ttyS0" ];
          boot.initrd.availableKernelModules = [
            "virtio_pci"
            "virtio_blk"
            "virtio_scsi"
            "sd_mod"
            "sr_mod"
          ];

          fileSystems."/" = {
            device = lib.mkForce "/dev/disk/by-label/nixos";
            fsType = lib.mkForce "ext4";
            options = lib.mkForce [
              "x-systemd.growfs"
              "x-initrd.mount"
            ];
          };

          swapDevices = [ ];

          system.stateVersion = "26.05";
        };

      forgejoImageModule =
        { vm, ... }:
        {
          imports = forgejoServiceModules;

          image = {
            baseName = "nixos-${vm.hostname}";
            format = "qcow2";
            # Use legacy BIOS for the imported Proxmox qcow2 to avoid needing an EFI
            # vars disk in the initial rebuild. Future VMs can choose OVMF explicitly.
            efiSupport = false;
          };

          virtualisation.diskSize = 8192;

          services.qemuGuest.enable = true;
          services.fstrim.enable = true;

          boot.growPartition = true;
          boot.kernelParams = [ "console=ttyS0" ];
          boot.initrd.availableKernelModules = [
            "virtio_pci"
            "virtio_blk"
            "virtio_scsi"
            "sd_mod"
            "sr_mod"
          ];

          system.stateVersion = "26.05";
        };

      minecraftServiceModule = inputs.minecraft.nixosModules.minecraft-service;

      minecraftStandaloneModule =
        { ... }:
        {
          imports = [
            ./nix/modules/services/minecraft-identity.nix
            minecraftServiceModule
          ];

          # Keep the standalone VM profile service-only: no Minecraft webapp.
          boot.loader.grub = {
            enable = true;
            device = "/dev/vda";
          };
          boot.growPartition = true;
          boot.kernelParams = [ "console=ttyS0" ];
          boot.initrd.availableKernelModules = [
            "virtio_pci"
            "virtio_blk"
            "virtio_scsi"
            "sd_mod"
            "sr_mod"
          ];

          fileSystems."/" = {
            device = "/dev/disk/by-label/nixos";
            fsType = "ext4";
            options = [
              "x-systemd.growfs"
              "x-initrd.mount"
            ];
          };

          swapDevices = [ ];

          services.qemuGuest.enable = true;
          services.fstrim.enable = true;

          system.stateVersion = "26.05";
        };

      minecraftImageModule =
        { vm, ... }:
        {
          imports = [
            ./nix/modules/services/minecraft-identity.nix
            minecraftServiceModule
          ];

          image = {
            baseName = "nixos-${vm.hostname}";
            format = "qcow2";
            efiSupport = false;
          };

          virtualisation.diskSize = 8192;

          services.qemuGuest.enable = true;
          services.fstrim.enable = true;

          boot.growPartition = true;
          boot.kernelParams = [ "console=ttyS0" ];
          boot.initrd.availableKernelModules = [
            "virtio_pci"
            "virtio_blk"
            "virtio_scsi"
            "sd_mod"
            "sr_mod"
          ];

          system.stateVersion = "26.05";
        };

      davServerImageModule =
        { vm, ... }:
        {
          imports = [ ./nix/modules/services/dav-server.nix ];

          image = {
            baseName = "nixos-${vm.hostname}";
            format = "qcow2";
            efiSupport = false;
          };

          virtualisation.diskSize = 8192;

          services.qemuGuest.enable = true;
          services.fstrim.enable = true;

          boot.growPartition = true;
          boot.kernelParams = [ "console=ttyS0" ];
          boot.initrd.availableKernelModules = [
            "virtio_pci"
            "virtio_blk"
            "virtio_scsi"
            "sd_mod"
            "sr_mod"
          ];

          system.stateVersion = "26.05";
        };

      mkExternalVm =
        {
          name,
          module,
          includeQemuGuest ? false,
          includeAgent ? true,
        }:
        mkNixosHost {
          inherit name;
          vm = fleet.vms.${name};
          modules = [
            disko.nixosModules.disko
            sops-nix.nixosModules.sops
          ]
          ++ commonVmModules
          ++ nixpkgs.lib.optionals includeQemuGuest [ ./nix/modules/common/qemu-guest.nix ]
          ++ nixpkgs.lib.optionals includeAgent agentVmModules
          ++ [ module ];
        };

      mkExternalImage =
        {
          name,
          module,
          includeAgent ? true,
        }:
        mkNixosHost {
          inherit name;
          vm = fleet.vms.${name};
          modules = [
            "${nixpkgs}/nixos/modules/virtualisation/disk-image.nix"
            sops-nix.nixosModules.sops
          ]
          ++ commonVmModules
          ++ nixpkgs.lib.optionals includeAgent agentVmModules
          ++ [ module ];
        };
    in
    {
      nixosModules = {
        forgejo-service = ./nix/modules/services/forgejo.nix;
        forgejo-bootstrap = ./nix/modules/services/forgejo-bootstrap.nix;
        forgejo = forgejoStandaloneModule;
        forgejo-image = forgejoImageModule;
        dav-server-service = ./nix/modules/services/dav-server.nix;
        dav-server-image = davServerImageModule;
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

        git = mkExternalVm {
          name = "git";
          module = forgejoStandaloneModule;
          includeQemuGuest = true;
        };

        gitImage = mkExternalImage {
          name = "git";
          module = forgejoImageModule;
        };

        minecraft = mkNixosHost {
          name = "minecraft";
          vm = fleet.vms.minecraft;
          modules = [
            inputs.microvm.nixosModules.microvm
            sops-nix.nixosModules.sops
            ./nix/modules/common/base.nix
            ./nix/modules/common/users.nix
            ./nix/modules/common/security.nix
            ./nix/modules/common/development.nix
            ./nix/modules/common/sops.nix
            ./nix/modules/common/nazar-context.nix
            ./nix/modules/common/pi-agent.nix
            ./nix/modules/host/microvm-guest.nix
            ./nix/modules/services/minecraft-identity.nix
            minecraftServiceModule
          ];
        };

        minecraftImage = mkExternalImage {
          name = "minecraft";
          module = minecraftImageModule;
        };

        "dav-server" = mkExternalVm {
          name = "dav-server";
          module = ./nix/modules/services/dav-server.nix;
          includeQemuGuest = true;
        };

        "dav-server-image" = mkExternalImage {
          name = "dav-server";
          module = davServerImageModule;
        };
      };

      packages.${system} = {
        inherit pi;
        git-qcow2 = self.nixosConfigurations.gitImage.config.system.build.image;
        minecraft-qcow2 = self.nixosConfigurations.minecraftImage.config.system.build.image;
        dav-server-qcow2 = self.nixosConfigurations."dav-server-image".config.system.build.image;
      };

      deploy.nodes = nixpkgs.lib.mapAttrs (name: vm: {
        # Deploy over private VM aliases.
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
          find flake.nix nix -type f -name '*.nix' -print0             | xargs -0 --no-run-if-empty nixfmt
        '';
      };
    };
}
