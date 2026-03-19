# flake.nix
{
  description = "nixPI — Pi-native AI companion OS on NixOS";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs, ... }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      lib = nixpkgs.lib;
      # pkgsUnfree is used only for boot nixosTest.  pkgs.testers.nixosTest
      # injects its own pkgs as nixpkgs.pkgs for test nodes, which means modules
      # cannot set nixpkgs.config (NixOS assertion).  Using a pkgs already created
      # with allowUnfree = true sidesteps the issue without touching any module.
      pkgsUnfree = import nixpkgs { inherit system; config.allowUnfree = true; };
      piAgent = pkgs.callPackage ./core/os/pkgs/pi {};
      appPackage = pkgs.callPackage ./core/os/pkgs/app { inherit piAgent; };

      specialArgs = { inherit piAgent appPackage; };
    in {
      packages.${system} = {
        pi        = piAgent;
        app = appPackage;
      };

      nixosModules = {
        # Single composable module exporting all nixPI feature modules.
        # Consuming flake.nix must provide piAgent and appPackage in specialArgs.
        nixpi = { piAgent, appPackage, ... }: {
          imports = [
            ./core/os/modules/options.nix
            ./core/os/modules/app.nix
            ./core/os/modules/llm.nix
            ./core/os/modules/matrix.nix
            ./core/os/modules/network.nix
            ./core/os/modules/shell.nix
            ./core/os/modules/update.nix
          ];
          # allowUnfree is intentionally NOT set here.
          # nixpkgs.config cannot be set in a module that is used inside
          # pkgs.testers.nixosTest (the test framework injects an externally
          # created pkgs, making the NixOS module system reject nixpkgs.config
          # overrides).  Consuming configurations set allowUnfree themselves.
        };

        # First-boot service module (included separately, not part of the portable nixPI module).
        firstboot = import ./core/os/modules/firstboot.nix;
      };

      # NixOS configuration for the nixPI desktop/workstation install.
      # Use this after installing standard NixOS:
      #   sudo nixos-rebuild switch --flake github:alexradunet/piBloom#desktop
      nixosConfigurations.desktop = nixpkgs.lib.nixosSystem {
        inherit system specialArgs;
        modules = [
          ./core/os/hosts/x86_64.nix
        ];
      };

      # NixOS configuration that mirrors a default nixPI install
      # (nixpi + firstboot + the standard machine defaults).
      # Used by checks.config and checks.boot below.
      nixosConfigurations.installed-test = nixpkgs.lib.nixosSystem {
        inherit system specialArgs;
        modules = [
          self.nixosModules.nixpi
          self.nixosModules.firstboot
          {
            # Default machine settings used by desktop.
            nixpkgs.config.allowUnfree = true;
            boot.loader.systemd-boot.enable = true;
            boot.loader.efi.canTouchEfiVariables = true;
            networking.hostName = "nixos";
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

      checks.${system} = 
        let
          # Import the NixOS integration test suite
          # Using pkgsUnfree so tests can use packages that require allowUnfree
          nixosTests = import ./tests/nixos { 
            pkgs = pkgsUnfree;
            inherit lib piAgent appPackage; 
          };
        in
        {
          # Fast: build the installed system closure locally — catches locale
          # errors, module conflicts, bad package references, and NixOS
          # evaluation failures without touching QEMU.
          config = self.nixosConfigurations.installed-test.config.system.build.toplevel;

          # Thorough: boot the installed system in a NixOS test VM and verify
          # that critical services come up.
          boot = pkgsUnfree.testers.nixosTest {
            name = "boot";

            nodes.workspace = { ... }: {
              imports = [
                self.nixosModules.nixpi
                self.nixosModules.firstboot
              ];
              _module.args = { inherit piAgent appPackage; };

              boot.loader.systemd-boot.enable = true;
              boot.loader.efi.canTouchEfiVariables = true;
              networking.hostName = "nixos";
              time.timeZone = "UTC";
              i18n.defaultLocale = "en_US.UTF-8";
              networking.networkmanager.enable = true;
              system.stateVersion = "25.05";

              # Give the VM enough disk for the nixPI closure
              virtualisation.diskSize = 20480;  # 20 GB
              virtualisation.memorySize = 4096;
            };

            testScript = ''
              workspace.start()
              workspace.wait_for_unit("multi-user.target", timeout=300)

              # Basic sanity: the pi user exists
              workspace.succeed("id pi")

              # nixpi-firstboot was attempted (exit 0 or 1 both accepted by unit)
              workspace.wait_for_unit("nixpi-firstboot.service", timeout=60)

              # NetworkManager is running
              workspace.succeed("systemctl is-active NetworkManager")
            '';
          };
        }
        // nixosTests;  # Merge in the new test suite

      devShells.${system}.default = pkgs.mkShell {
        packages = with pkgs; [
          # JavaScript / TypeScript
          nodejs
          typescript
          biome

          # Linting & utilities
          shellcheck
          jq
          curl
          git
          just
        ];

        # Note: vitest is not in nixpkgs-unstable — use 'npm install' then 'npx vitest'

        shellHook = ''
          echo "nixPI dev shell"
          echo "Run 'npm install' to set up JS dependencies (includes vitest)"
        '';
      };
    };
}
