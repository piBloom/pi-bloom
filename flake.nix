# flake.nix
{
  description = "Bloom OS — Pi-native AI companion OS on NixOS";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    disko = {
      url = "github:nix-community/disko";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    llm-agents-nix = {
      url = "github:numtide/llm-agents.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, disko, llm-agents-nix, ... }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      piAgent = llm-agents-nix.packages.${system}.pi;
      bloomApp = pkgs.callPackage ./core/os/pkgs/bloom-app { inherit piAgent; };

      specialArgs = { inherit piAgent bloomApp; };
    in {
      packages.${system} = {
        bloom-app = bloomApp;

        # QCOW2 disk image with EFI support
        qcow2 = (nixpkgs.lib.nixosSystem {
          inherit system specialArgs;
          modules = [
            ./core/os/hosts/x86_64.nix
            ({ config, pkgs, lib, ... }: {
              imports = [ "${nixpkgs}/nixos/modules/virtualisation/disk-image.nix" ];
              
              # Image configuration
              image.format = "qcow2";
              image.efiSupport = true;
              
              # Ensure boot loader is installed
              boot.loader.systemd-boot.enable = true;
              boot.loader.efi.canTouchEfiVariables = true;
              
              # File system configuration for the image
              fileSystems."/" = {
                device = "/dev/disk/by-label/nixos";
                fsType = "ext4";
                autoResize = true;
              };
              
              fileSystems."/boot" = {
                device = "/dev/disk/by-label/ESP";
                fsType = "vfat";
              };
              
              # Enable growpart for auto-resize on first boot
              boot.growPartition = true;
              
              # Add virtio drivers for VM disk/network
              boot.initrd.availableKernelModules = [ "virtio_net" "virtio_pci" "virtio_blk" "virtio_scsi" "9p" "9pnet_virtio" ];
              boot.kernelModules = [ "kvm-intel" "kvm-amd" ];
            })
          ];
        }).config.system.build.image;

        # Raw disk image
        raw = (nixpkgs.lib.nixosSystem {
          inherit system specialArgs;
          modules = [
            ./core/os/hosts/x86_64.nix
            ({ config, pkgs, lib, ... }: {
              imports = [ "${nixpkgs}/nixos/modules/virtualisation/disk-image.nix" ];
              image.format = "raw";
              image.efiSupport = true;
              
              boot.loader.systemd-boot.enable = true;
              boot.loader.efi.canTouchEfiVariables = true;
              
              fileSystems."/" = {
                device = "/dev/disk/by-label/nixos";
                fsType = "ext4";
                autoResize = true;
              };
              
              fileSystems."/boot" = {
                device = "/dev/disk/by-label/ESP";
                fsType = "vfat";
              };
              
              boot.growPartition = true;
              
              # Add virtio drivers for VM disk/network
              boot.initrd.availableKernelModules = [ "virtio_net" "virtio_pci" "virtio_blk" "virtio_scsi" "9p" "9pnet_virtio" ];
              boot.kernelModules = [ "kvm-intel" "kvm-amd" ];
            })
          ];
        }).config.system.build.image;

        # Installer ISO
        iso = (nixpkgs.lib.nixosSystem {
          inherit system specialArgs;
          modules = [
            ./core/os/hosts/x86_64.nix
            "${nixpkgs}/nixos/modules/installer/cd-dvd/installation-cd-minimal.nix"
          ];
        }).config.system.build.isoImage;
      };

      # NixOS configuration for bare-metal install
      nixosConfigurations.bloom-x86_64 = nixpkgs.lib.nixosSystem {
        inherit system specialArgs;
        modules = [
          ./core/os/hosts/x86_64.nix
          disko.nixosModules.disko
          ./core/os/hosts/x86_64-disk.nix
        ];
      };
    };
}
