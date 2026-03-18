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
      # pkgsUnfree is used only for bloom-boot nixosTest.  pkgs.testers.nixosTest
      # injects its own pkgs as nixpkgs.pkgs for test nodes, which means modules
      # cannot set nixpkgs.config (NixOS assertion).  Using a pkgs already created
      # with allowUnfree = true sidesteps the issue without touching any module.
      pkgsUnfree = import nixpkgs { inherit system; config.allowUnfree = true; };
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

        # Graphical installer ISO (Calamares + GNOME)
        iso = (nixpkgs.lib.nixosSystem {
          inherit system;
          # specialArgs includes bloomApp and piAgent (for system packages) plus
          # the raw flake inputs so x86_64-installer.nix can embed their source
          # trees in the squashfs.  With those sources present in the ISO store,
          # nix build during installation finds them by narHash and skips all
          # GitHub downloads → fully offline installation.
          specialArgs = specialArgs // {
            nixpkgsSrc     = nixpkgs;
            bloomSrc       = self;
            llmAgentsSrc   = llm-agents-nix;
          };
          modules = [
            ./core/os/hosts/x86_64-installer.nix
          ];
        }).config.system.build.isoImage;
      };

      nixosModules = {
        # Single composable module exporting all six Bloom feature modules.
        # Consuming flake.nix must provide piAgent and bloomApp in specialArgs.
        bloom = { piAgent, bloomApp, ... }: {
          imports = [
            ./core/os/modules/bloom-options.nix
            ./core/os/modules/bloom-app.nix
            ./core/os/modules/bloom-llm.nix
            ./core/os/modules/bloom-matrix.nix
            ./core/os/modules/bloom-network.nix
            ./core/os/modules/bloom-shell.nix
            ./core/os/modules/bloom-update.nix
          ];
          # allowUnfree is intentionally NOT set here.
          # nixpkgs.config cannot be set in a module that is used inside
          # pkgs.testers.nixosTest (the test framework injects an externally
          # created pkgs, making the NixOS module system reject nixpkgs.config
          # overrides).  Consuming configurations set allowUnfree themselves
          # (x86_64.nix, bloom-installed-test, and the installer-generated
          # host-config.nix all set nixpkgs.config.allowUnfree = true).
        };

        # First-boot service module (included separately, not part of portable bloom module).
        bloom-firstboot = import ./core/os/modules/bloom-firstboot.nix;
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

      # NixOS configuration that mirrors exactly what the Calamares installer
      # generates at install time (bloom + bloom-firstboot + minimal host-config).
      # Used by checks.bloom-config and checks.bloom-boot below.
      nixosConfigurations.bloom-installed-test = nixpkgs.lib.nixosSystem {
        inherit system specialArgs;
        modules = [
          self.nixosModules.bloom
          self.nixosModules.bloom-firstboot
          {
            # Minimal host-config.nix equivalent (what Calamares would generate)
            nixpkgs.config.allowUnfree = true;
            boot.loader.systemd-boot.enable = true;
            boot.loader.efi.canTouchEfiVariables = true;
            networking.hostName = "bloom";
            time.timeZone = "UTC";
            i18n.defaultLocale = "en_US.UTF-8";
            services.xserver.xkb = { layout = "us"; variant = ""; };
            console.keyMap = "us";
            networking.networkmanager.enable = true;
            system.stateVersion = "25.05";
            # Minimal stub filesystems (not real hardware, just enough to evaluate)
            fileSystems."/" = { device = "/dev/vda"; fsType = "ext4"; };
            fileSystems."/boot" = { device = "/dev/vda1"; fsType = "vfat"; };
          }
        ];
      };

      checks.${system} = {
        # Fast: build the installed system closure locally — catches locale errors,
        # module conflicts, bad package references, and NixOS evaluation failures
        # without touching QEMU.  Run with: nix build .#checks.x86_64-linux.bloom-config
        bloom-config = self.nixosConfigurations.bloom-installed-test.config.system.build.toplevel;

        # Thorough: boot the installed system in a NixOS test VM and verify that
        # critical services come up.  Run with: nix build .#checks.x86_64-linux.bloom-boot
        bloom-boot = pkgsUnfree.testers.nixosTest {
          name = "bloom-boot";

          nodes.bloom = { ... }: {
            imports = [
              self.nixosModules.bloom
              self.nixosModules.bloom-firstboot
            ];
            _module.args = { inherit piAgent bloomApp; };

            boot.loader.systemd-boot.enable = true;
            boot.loader.efi.canTouchEfiVariables = true;
            networking.hostName = "bloom";
            time.timeZone = "UTC";
            i18n.defaultLocale = "en_US.UTF-8";
            networking.networkmanager.enable = true;
            system.stateVersion = "25.05";

            # Give the VM enough disk for the bloom closure
            virtualisation.diskSize = 20480;  # 20 GB
            virtualisation.memorySize = 4096;
          };

          testScript = ''
            bloom.start()
            bloom.wait_for_unit("multi-user.target", timeout=300)

            # Basic sanity: the pi user exists
            bloom.succeed("id pi")

            # bloom-firstboot was attempted (exit 0 or 1 both accepted by unit)
            bloom.wait_for_unit("bloom-firstboot.service", timeout=60)

            # NetworkManager is running
            bloom.succeed("systemctl is-active NetworkManager")
          '';
        };
      };
    };
}
