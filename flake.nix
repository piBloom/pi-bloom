# flake.nix
{
  description = "NixPI — Pi-native AI companion OS on NixOS";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    disko = {
      url = "github:nix-community/disko";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    nixos-hardware.url = "github:NixOS/nixos-hardware";
  };

  outputs = { self, nixpkgs, disko, nixos-hardware, ... }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      lib = nixpkgs.lib;
      nixpiSource = lib.cleanSource ./.;
      installerHelper = pkgs.callPackage ./core/os/pkgs/installer {
        inherit nixpiSource piAgent appPackage setupApplyPackage self;
      };
      setupApplyPackage = pkgs.callPackage ./core/os/pkgs/nixpi-setup-apply {};
      # pkgsUnfree is used only for boot nixosTest.  pkgs.testers.nixosTest
      # injects its own pkgs as nixpkgs.pkgs for test nodes, which means modules
      # cannot set nixpkgs.config (NixOS assertion).  Using a pkgs already created
      # with allowUnfree = true sidesteps the issue without touching any module.
      pkgsUnfree = import nixpkgs { inherit system; config.allowUnfree = true; };
      piAgent = pkgs.callPackage ./core/os/pkgs/pi {};
      appPackage = pkgs.callPackage ./core/os/pkgs/app { inherit piAgent; };

      specialArgs = { inherit piAgent appPackage self installerHelper disko setupApplyPackage; };
    in {
      packages.${system} = {
        pi = piAgent;
        app = appPackage;
        nixpi-installer = installerHelper;
        nixpi-setup-apply = setupApplyPackage;
        installerIso = self.nixosConfigurations.installer-iso.config.system.build.isoImage;
      };

      formatter.${system} = pkgs.nixfmt-rfc-style;

      nixosModules = {
        # Minimal installed NixPI base without the Pi runtime, collab stack,
        # desktop shell, or operator tooling bundle.
        nixpi-base-no-shell = { ... }: {
          imports = [
            ./core/os/modules/options.nix
            ./core/os/modules/network.nix
            ./core/os/modules/update.nix
          ];
        };

        # Minimal installed NixPI base with the operator shell/bootstrap path.
        nixpi-base = { ... }: {
          imports = [
            self.nixosModules.nixpi-base-no-shell
            ./core/os/modules/shell.nix
          ];
        };

        # Portable NixPI module set without the operator shell/user module.
        # Useful for tests that intentionally define their own primary user.
        nixpi-no-shell = { piAgent, appPackage, ... }: {
          imports = [
            self.nixosModules.nixpi-base-no-shell
            ./core/os/modules/runtime.nix
            ./core/os/modules/collab.nix
            ./core/os/modules/tooling.nix
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
        firstboot = import ./core/os/modules/firstboot;
      };

      # Managed NixPI desktop profile used for local builds and installer generation.
      nixosConfigurations.desktop = nixpkgs.lib.nixosSystem {
        inherit system specialArgs;
        modules = [
          ./core/os/hosts/x86_64.nix
          {
            nixpkgs.hostPlatform = system;
            nixpkgs.config.allowUnfree = true;
          }
        ];
      };

      # Raspberry Pi 4 target (aarch64-linux).
      # Build on native aarch64 hardware or with binfmt/QEMU:
      #   nix build .#nixosConfigurations.rpi4.config.system.build.toplevel
      nixosConfigurations.rpi4 = nixpkgs.lib.nixosSystem {
        system = "aarch64-linux";
        specialArgs = specialArgs // { inherit nixos-hardware; };
        modules = [
          nixos-hardware.nixosModules.raspberry-pi-4
          ./core/os/hosts/rpi4.nix
          {
            nixpkgs.hostPlatform = "aarch64-linux";
            nixpkgs.config.allowUnfree = true;
          }
        ];
      };

      # Raspberry Pi 5 target (aarch64-linux).
      nixosConfigurations.rpi5 = nixpkgs.lib.nixosSystem {
        system = "aarch64-linux";
        specialArgs = specialArgs // { inherit nixos-hardware; };
        modules = [
          nixos-hardware.nixosModules.raspberry-pi-5
          ./core/os/hosts/rpi5.nix
          {
            nixpkgs.hostPlatform = "aarch64-linux";
            nixpkgs.config.allowUnfree = true;
          }
        ];
      };

      # Minimal installer ISO built on top of the standard NixOS minimal image.
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
          ./core/os/hosts/x86_64.nix
          {
            nixpkgs.hostPlatform = system;
            nixpkgs.config.allowUnfree = true;
            nixpi.primaryUser = "alex";
            networking.hostName = "nixos";
            fileSystems."/" = { device = "/dev/vda"; fsType = "ext4"; };
            fileSystems."/boot" = { device = "/dev/vda1"; fsType = "vfat"; };
          }
        ];
      };

      checks.${system} =
        let
          installerFrontendSource = ./core/os/pkgs/installer/nixpi-installer.sh;
          mkInstallerGeneratedConfig = {
            rootDevice,
            bootDevice,
          }: (nixpkgs.lib.nixosSystem {
            inherit system specialArgs;
            modules = [
              ({ config, ... }: {
                imports = [
                  "${nixpiSource}/core/os/modules/firstboot/default.nix"
                  "${nixpiSource}/core/os/modules/network.nix"
                  "${nixpiSource}/core/os/modules/shell.nix"
                  "${nixpiSource}/core/os/modules/update.nix"
                  "${nixpiSource}/core/os/modules/app.nix"
                  "${nixpiSource}/core/os/modules/service-surface.nix"
                  "${nixpiSource}/core/os/modules/setup-apply.nix"
                ];

                networking.hostName = "nixpi";
                time.timeZone = "UTC";
                i18n.defaultLocale = "en_US.UTF-8";
                nixpkgs.config.allowUnfree = true;
                nix.settings.experimental-features = [ "nix-command" "flakes" ];
                nixpi.primaryUser = "human";
                users.groups.human = {};
                users.users.human = {
                  isNormalUser = true;
                  group = "human";
                  extraGroups = [ "networkmanager" ];
                  initialPassword = "installerpass123";
                };
                system.activationScripts.nixpi-bootstrap-primary-password = ''
                  bootstrapPasswordFile="${config.nixpi.stateDir}/bootstrap/primary-user-password"
                  install -d -m 0755 -o root -g root "$(dirname "$bootstrapPasswordFile")"
                  install -m 0600 -o root -g root /dev/null "$bootstrapPasswordFile"
                  printf '%s' "installerpass123" > "$bootstrapPasswordFile"
                '';
                boot.loader.systemd-boot.enable = true;
                boot.loader.efi.canTouchEfiVariables = true;
                fileSystems."/" = {
                  device = rootDevice;
                  fsType = "ext4";
                };
                fileSystems."/boot" = {
                  device = bootDevice;
                  fsType = "vfat";
                };
                system.stateVersion = "25.05";
              })
            ];
          }).config.system.build.toplevel;
          # Import the NixOS integration test suite
          # Using pkgsUnfree so tests can use packages that require allowUnfree
          nixosTests = import ./tests/nixos {
            pkgs = pkgsUnfree;
            inherit lib piAgent appPackage self installerHelper;
          };
          bootCheck = pkgsUnfree.testers.runNixOSTest {
            name = "boot";

            nodes.nixpi = { ... }: {
              imports = [
                ./core/os/hosts/x86_64.nix
              ];
              _module.args = { inherit piAgent appPackage self; };

              nixpi.primaryUser = "alex";

              networking.hostName = "nixos";

              # Give the VM enough disk for the NixPI closure
              virtualisation.diskSize = 20480;  # 20 GB
              virtualisation.memorySize = 4096;
            };

            testScript = ''
              nixpi = machines[0]

              nixpi.start()
              nixpi.wait_for_unit("multi-user.target", timeout=300)

              # Basic sanity: the default operator exists and bootstrap tooling is installed
              nixpi.succeed("id alex")

              nixpi.succeed("command -v nixpi-bootstrap")

              # NetworkManager is running
              nixpi.succeed("systemctl is-active NetworkManager")
            '';
          };
          mkCheckLane = name: entries:
            pkgs.linkFarm name entries;
          diskoLayoutsCheck = pkgs.runCommandLocal "disko-layouts-check" {
            nativeBuildInputs = [ pkgs.nix ];
          } ''
            nix-instantiate --parse \
              ${./core/os/installer/layouts/standard.nix} >/dev/null
            nix-instantiate --parse \
              ${./core/os/installer/layouts/swap.nix} >/dev/null

            grep -F '"@DISK@"' ${./core/os/installer/layouts/standard.nix} >/dev/null
            grep -F '"@DISK@"' ${./core/os/installer/layouts/swap.nix} >/dev/null
            grep -F '"@SWAP_SIZE@"' ${./core/os/installer/layouts/swap.nix} >/dev/null
            grep -F 'disko.devices' ${./core/os/installer/layouts/standard.nix} >/dev/null
            grep -F 'disko.devices' ${./core/os/installer/layouts/swap.nix} >/dev/null
            touch "$out"
          '';
        in
        {
          # Fast: build the installed system closure locally — catches locale
          # errors, module conflicts, bad package references, and NixOS
          # evaluation failures without touching QEMU.
          config = self.nixosConfigurations.installed-test.config.system.build.toplevel;

          # Validate installer script syntax and the new installer packaging shape.
          installer-frontend = pkgs.runCommandLocal "installer-frontend-check" { } ''
            bash -n "${installerFrontendSource}"
            ! test -e "${installerHelper}/share/nixpi-installer/nixpi-install-module.nix.in"
            grep -F 'PREFILL_FILE=""' "${installerHelper}/share/nixpi-installer/nixpi-installer.sh" >/dev/null
            grep -F 'HOSTNAME_VALUE="nixpi"' "${installerHelper}/share/nixpi-installer/nixpi-installer.sh" >/dev/null
            grep -F 'PRIMARY_USER_VALUE="human"' "${installerHelper}/share/nixpi-installer/nixpi-installer.sh" >/dev/null
            grep -F 'CONFIG_SOURCE_DIR="@configSourceDir@"' "${installerFrontendSource}" >/dev/null
            grep -F 'validate_system_closure()' "${installerFrontendSource}" >/dev/null
            grep -F -- '--system only supports the baked desktop closure:' "${installerFrontendSource}" >/dev/null
            ! grep -F '. "$prefill_path"' "${installerFrontendSource}" >/dev/null
            ! grep -F 'Hostname [' "${installerHelper}/share/nixpi-installer/nixpi-installer.sh" >/dev/null
            ! grep -F 'Primary user [' "${installerHelper}/share/nixpi-installer/nixpi-installer.sh" >/dev/null
            ! grep -F -- '--hostname)' "${installerFrontendSource}" >/dev/null
            ! grep -F -- '--primary-user)' "${installerFrontendSource}" >/dev/null
            grep -F 'DESKTOP_SYSTEM="@desktopSystem@"' "${installerFrontendSource}" >/dev/null
            grep -F "${self.nixosConfigurations.desktop.config.system.build.toplevel}" "${installerHelper}/share/nixpi-installer/nixpi-installer.sh" >/dev/null
            test -e "${installerHelper}/share/nixpi-installer/nixpi-config/core/os/hosts/x86_64.nix"
            grep -F './nixpi-config/core/os/hosts/x86_64.nix' "${installerHelper}/share/nixpi-installer/nixpi-installer.sh" >/dev/null
            grep -F '_module.args = {' "${installerHelper}/share/nixpi-installer/nixpi-installer.sh" >/dev/null
            touch "$out"
          '';

          setup-apply-package = pkgs.runCommandLocal "setup-apply-package-check" { } ''
            bash -n "${./core/scripts/nixpi-setup-apply.sh}"
            wrapped="${setupApplyPackage}/bin/nixpi-setup-apply"
            ! grep -E '/jq-[^/]+/bin' "$wrapped"
            ! grep -E '/git-[^/]+/bin' "$wrapped"
            ! grep -F 'SETUP_NAME is required' "${./core/scripts/nixpi-setup-apply.sh}"
            ! grep -F 'SETUP_EMAIL is required' "${./core/scripts/nixpi-setup-apply.sh}"
            ! grep -F 'SETUP_USERNAME is required' "${./core/scripts/nixpi-setup-apply.sh}"
            ! grep -F 'SETUP_PASSWORD is required' "${./core/scripts/nixpi-setup-apply.sh}"
            ! grep -F 'git clone' "${./core/scripts/nixpi-setup-apply.sh}"
            ! grep -F 'nixos-rebuild switch' "${./core/scripts/nixpi-setup-apply.sh}"
            ! grep -F 'jq --arg key' "${./core/scripts/nixpi-setup-apply.sh}"
            touch "$out"
          '';

          flake-topology = pkgs.runCommandLocal "flake-topology-check" { } ''
            ! grep -F 'desktop-vm' ${./flake.nix}
            ! test -e ${./.}/core/os/hosts/x86_64-vm.nix
            ! test -e ${./.}/tools/run-qemu.sh
            grep -F 'self.nixosConfigurations.desktop.config.system.build.toplevel' ${./core/os/hosts/installer-iso.nix} >/dev/null
            grep -F 'services.fail2ban.enable = lib.mkForce false;' ${./core/os/hosts/installer-iso.nix} >/dev/null
            touch "$out"
          '';

          disko-layouts = diskoLayoutsCheck;

          installer-generated-config = mkInstallerGeneratedConfig {
            rootDevice = "/dev/vda2";
            bootDevice = "/dev/vda1";
          };

          installer-generated-config-nvme = mkInstallerGeneratedConfig {
            rootDevice = "/dev/nvme0n1p2";
            bootDevice = "/dev/nvme0n1p1";
          };

          installer-generated-config-sata = mkInstallerGeneratedConfig {
            rootDevice = "/dev/sda2";
            bootDevice = "/dev/sda1";
          };

          installer-iso = self.nixosConfigurations.installer-iso.config.system.build.isoImage;

          # Thorough: boot the installed system in a NixOS test VM and verify
          # that critical services come up.
          boot = bootCheck;

          nixos-smoke = mkCheckLane "nixos-smoke" [
            { name = "disko-layouts"; path = diskoLayoutsCheck; }
            { name = "smoke-firstboot"; path = nixosTests.smoke-firstboot; }
            { name = "smoke-security"; path = nixosTests.smoke-security; }
            { name = "smoke-broker"; path = nixosTests.smoke-broker; }
            { name = "installer-smoke"; path = nixosTests.installer-smoke; }
          ];

          nixos-full = mkCheckLane "nixos-full" [
            { name = "boot"; path = bootCheck; }
            { name = "nixpi-firstboot"; path = nixosTests.nixpi-firstboot; }
            { name = "nixpi-network"; path = nixosTests.nixpi-network; }
            { name = "nixpi-e2e"; path = nixosTests.nixpi-e2e; }
            { name = "nixpi-security"; path = nixosTests.nixpi-security; }
            { name = "nixpi-modular-services"; path = nixosTests.nixpi-modular-services; }
            { name = "nixpi-bootstrap-mode"; path = nixosTests.nixpi-bootstrap-mode; }
            { name = "nixpi-post-setup-lockdown"; path = nixosTests.nixpi-post-setup-lockdown; }
            { name = "nixpi-broker"; path = nixosTests.nixpi-broker; }
            { name = "nixpi-update"; path = nixosTests.nixpi-update; }
            { name = "nixpi-options-validation"; path = nixosTests.nixpi-options-validation; }
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
