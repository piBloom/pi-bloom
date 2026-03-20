# flake.nix
{
  description = "NixPI — Pi-native AI companion OS on NixOS";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs, ... }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      lib = nixpkgs.lib;
      nixpiSource = lib.cleanSource ./.;
      installerCalamaresOverlay = import ./core/os/overlays/installer-calamares.nix {
        inherit nixpiSource;
      };
      installerPkgs = import nixpkgs {
        inherit system;
        config.allowUnfree = true;
        overlays = [ installerCalamaresOverlay ];
      };
      # pkgsUnfree is used only for boot nixosTest.  pkgs.testers.nixosTest
      # injects its own pkgs as nixpkgs.pkgs for test nodes, which means modules
      # cannot set nixpkgs.config (NixOS assertion).  Using a pkgs already created
      # with allowUnfree = true sidesteps the issue without touching any module.
      pkgsUnfree = import nixpkgs { inherit system; config.allowUnfree = true; };
      piAgent = pkgs.callPackage ./core/os/pkgs/pi {};
      appPackage = pkgs.callPackage ./core/os/pkgs/app { inherit piAgent; };

      specialArgs = { inherit piAgent appPackage self; };
    in {
      packages.${system} = {
        pi = piAgent;
        app = appPackage;
        installerIso = self.nixosConfigurations.installer-iso.config.system.build.isoImage;
      };

      formatter.${system} = pkgs.nixfmt-rfc-style;

      nixosModules = {
        # Portable NixPI module set without the operator shell/user module.
        # Useful for tests that intentionally define their own primary user.
        nixpi-no-shell = { piAgent, appPackage, ... }: {
          imports = [
            ./core/os/modules/options.nix
            ./core/os/modules/app.nix
            ./core/os/modules/broker.nix
            ./core/os/modules/llm.nix
            ./core/os/modules/matrix.nix
            ./core/os/modules/network.nix
            ./core/os/modules/update.nix
          ];
        };

        # Single composable module exporting all NixPI feature modules.
        # Consuming flake.nix must provide piAgent and appPackage in specialArgs.
        nixpi = { piAgent, appPackage, ... }: {
          imports = [
            self.nixosModules.nixpi-no-shell
            ./core/os/modules/shell.nix
          ];
          # allowUnfree is intentionally NOT set here.
          # nixpkgs.config cannot be set in a module that is used inside
          # pkgs.testers.nixosTest (the test framework injects an externally
          # created pkgs, making the NixOS module system reject nixpkgs.config
          # overrides).  Consuming configurations set allowUnfree themselves.
        };

        # First-boot service module (included separately, not part of the portable NixPI module).
        firstboot = import ./core/os/modules/firstboot.nix;
      };

      # Managed NixPI desktop profile used for local builds and installer generation.
      nixosConfigurations.desktop = nixpkgs.lib.nixosSystem {
        inherit system specialArgs;
        modules = [
          ./core/os/hosts/x86_64.nix
        ];
      };

      # Local VM/dev profile that adds VM-only mounts on top of the desktop profile.
      nixosConfigurations.desktop-vm = nixpkgs.lib.nixosSystem {
        inherit system specialArgs;
        modules = [
          ./core/os/hosts/x86_64-vm.nix
        ];
      };

      # Graphical installer ISO built on top of the standard NixOS Calamares image.
      nixosConfigurations.installer-iso = nixpkgs.lib.nixosSystem {
        inherit system specialArgs;
        modules = [
          ./core/os/hosts/installer-iso.nix
        ];
      };

      # NixOS configuration that mirrors a default NixPI install
      # (nixpi + firstboot + the standard machine defaults).
      # Used by checks.config and checks.boot below.
      nixosConfigurations.installed-test = nixpkgs.lib.nixosSystem {
        inherit system specialArgs;
        modules = [
          self.nixosModules.nixpi
          self.nixosModules.firstboot
          {
            nixpi.primaryUser = "alex";
            nixpi.install.mode = "managed-user";
            nixpi.createPrimaryUser = true;
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
          calamaresHelper = ./core/os/pkgs/calamares-nixos-extensions/nixpi_calamares.py;
          calamaresHelperTests = ./core/os/pkgs/calamares-nixos-extensions/test_nixpi_calamares.py;
          # Import the NixOS integration test suite
          # Using pkgsUnfree so tests can use packages that require allowUnfree
          nixosTests = import ./tests/nixos {
            pkgs = pkgsUnfree;
            inherit lib piAgent appPackage self installerPkgs;
          };
          bootCheck = pkgsUnfree.testers.runNixOSTest {
            name = "boot";

            nodes.nixpi = { ... }: {
              imports = [
                self.nixosModules.nixpi
                self.nixosModules.firstboot
              ];
              _module.args = { inherit piAgent appPackage; };

              nixpi.primaryUser = "alex";
              nixpi.install.mode = "managed-user";
              nixpi.createPrimaryUser = true;

              boot.loader.systemd-boot.enable = true;
              boot.loader.efi.canTouchEfiVariables = true;
              networking.hostName = "nixos";
              time.timeZone = "UTC";
              i18n.defaultLocale = "en_US.UTF-8";
              networking.networkmanager.enable = true;
              system.stateVersion = "25.05";

              # Give the VM enough disk for the NixPI closure
              virtualisation.diskSize = 20480;  # 20 GB
              virtualisation.memorySize = 4096;
            };

            testScript = ''
              nixpi = machines[0]

              nixpi.start()
              nixpi.wait_for_unit("multi-user.target", timeout=300)

              # Basic sanity: the default operator and service users exist
              nixpi.succeed("id alex")
              nixpi.succeed("id agent")

              # setup is now owned by the interactive wizard; just verify it is installed
              nixpi.succeed("command -v setup-wizard.sh")

              # NetworkManager is running
              nixpi.succeed("systemctl is-active NetworkManager")
            '';
          };
          mkCheckLane = name: entries:
            pkgs.linkFarm name entries;
        in
        {
          # Fast: build the installed system closure locally — catches locale
          # errors, module conflicts, bad package references, and NixOS
          # evaluation failures without touching QEMU.
          config = self.nixosConfigurations.installed-test.config.system.build.toplevel;

          # Fast installer-specific guard: build the exact Calamares extension
          # used by the ISO and validate the generated Python job artifact.
          installer-calamares = installerPkgs.runCommandLocal "installer-calamares-check" {
            nativeBuildInputs = [ installerPkgs.python3 ];
          } ''
            module="${installerPkgs.calamares-nixos-extensions}/lib/calamares/modules/nixos/main.py"
            grep -F 'def write_nixpi_install_artifacts(' "$module" >/dev/null
            grep -F 'nix.settings.experimental-features = [ "nix-command" "flakes" ];' "$module" >/dev/null
            grep -F '"--option",' "$module" >/dev/null
            grep -F '"extra-experimental-features",' "$module" >/dev/null
            grep -F '"nix-command flakes",' "$module" >/dev/null
            if grep -F '"--flake",' "$module" >/dev/null; then
              echo "unexpected nixos-install flake mode in $module" >&2
              exit 1
            fi
            PYTHONPYCACHEPREFIX="$TMPDIR/pycache" python3 -m py_compile "$module"
            touch "$out"
          '';

          installer-backend = installerPkgs.runCommandLocal "installer-backend-check" {
            nativeBuildInputs = [ installerPkgs.python3 ];
          } ''
            export NIXPI_CALAMARES_HELPER="${calamaresHelper}"
            python3 "${calamaresHelperTests}"
            touch "$out"
          '';

          # Regression guard for the local desktop VM path used by `just qcow2`.
          desktop-vm = self.nixosConfigurations.desktop-vm.config.system.build.vm;
          installer-iso = self.nixosConfigurations.installer-iso.config.system.build.isoImage;

          # Thorough: boot the installed system in a NixOS test VM and verify
          # that critical services come up.
          boot = bootCheck;

          nixos-smoke = mkCheckLane "nixos-smoke" [
            { name = "smoke-matrix"; path = nixosTests.smoke-matrix; }
            { name = "smoke-firstboot"; path = nixosTests.smoke-firstboot; }
            { name = "smoke-security"; path = nixosTests.smoke-security; }
            { name = "smoke-broker"; path = nixosTests.smoke-broker; }
          ];

          nixos-full = mkCheckLane "nixos-full" [
            { name = "boot"; path = bootCheck; }
            { name = "nixpi-matrix"; path = nixosTests.nixpi-matrix; }
            { name = "nixpi-firstboot"; path = nixosTests.nixpi-firstboot; }
            { name = "localai"; path = nixosTests.localai; }
            { name = "nixpi-network"; path = nixosTests.nixpi-network; }
            { name = "nixpi-daemon"; path = nixosTests.nixpi-daemon; }
            { name = "nixpi-e2e"; path = nixosTests.nixpi-e2e; }
            { name = "nixpi-home"; path = nixosTests.nixpi-home; }
            { name = "nixpi-security"; path = nixosTests.nixpi-security; }
            { name = "nixpi-modular-services"; path = nixosTests.nixpi-modular-services; }
            { name = "nixpi-matrix-bridge"; path = nixosTests.nixpi-matrix-bridge; }
            { name = "nixpi-bootstrap-mode"; path = nixosTests.nixpi-bootstrap-mode; }
            { name = "nixpi-post-setup-lockdown"; path = nixosTests.nixpi-post-setup-lockdown; }
            { name = "nixpi-broker"; path = nixosTests.nixpi-broker; }
          ];

          nixos-destructive = mkCheckLane "nixos-destructive" [
            { name = "nixpi-installer-smoke"; path = nixosTests.nixpi-installer-smoke; }
            { name = "nixpi-post-setup-lockdown"; path = nixosTests.nixpi-post-setup-lockdown; }
            { name = "nixpi-broker"; path = nixosTests.nixpi-broker; }
          ];
        }
        // nixosTests;  # Merge in the new test suite

      devShells.${system}.default = pkgs.mkShell {
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
    };
}
