# flake.nix
{
  description = "NixPI — Pi-native AI companion OS on NixOS";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    nixpkgs-stable.url = "github:NixOS/nixpkgs/nixos-25.11";
    disko.url = "github:nix-community/disko";
    disko.inputs.nixpkgs.follows = "nixpkgs-stable";
    nixos-anywhere.url = "github:nix-community/nixos-anywhere";
    nixos-anywhere.inputs.nixpkgs.follows = "nixpkgs-stable";
  };

  outputs =
    {
      self,
      nixpkgs,
      nixpkgs-stable,
      disko,
      nixos-anywhere,
      ...
    }:
    let
      system = "x86_64-linux";
      inherit (nixpkgs) lib;
      stableNixOSRelease = "25.11";
      stableNixpkgsFlakeUrl = "github:NixOS/nixpkgs/nixos-${stableNixOSRelease}";
      installFinalizeSystemFlakeScript = builtins.readFile ./core/scripts/nixpi-init-system-flake.sh;
      flakeSource = builtins.readFile ./flake.nix;
      supportedSystems = [
        system
        "aarch64-linux"
      ];
      moduleSets = import ./core/os/modules/module-sets.nix;
      forAllSystems = lib.genAttrs supportedSystems;
      mkPkgs = system: import nixpkgs { inherit system; };
      mkPackages =
        system:
        let
          pkgs = mkPkgs system;
          piAgent = pkgs.callPackage ./core/os/pkgs/pi { };
          appPackage = pkgs.callPackage ./core/os/pkgs/app { inherit piAgent; };
        in
        {
          pi = piAgent;
          app = appPackage;
          nixpi-rebuild = pkgs.callPackage ./core/os/pkgs/nixpi-rebuild { };
          nixpi-rebuild-pull = pkgs.callPackage ./core/os/pkgs/nixpi-rebuild-pull { };
          nixpi-deploy-ovh = pkgs.callPackage ./core/os/pkgs/nixpi-deploy-ovh {
            nixosAnywherePackage = nixos-anywhere.packages.${system}.nixos-anywhere;
          };
          nixpi-setup-apply = pkgs.callPackage ./core/os/pkgs/nixpi-setup-apply { };
        };
      pkgs = mkPkgs system;
      # pkgsUnfree is used only for boot nixosTest.  pkgs.testers.nixosTest
      # injects its own pkgs as nixpkgs.pkgs for test nodes, which means modules
      # cannot set nixpkgs.config (NixOS assertion).  Using a pkgs already created
      # with allowUnfree = true sidesteps the issue without touching any module.
      pkgsUnfree = import nixpkgs {
        inherit system;
        config.allowUnfree = true;
      };
      mkConfiguredSystem =
        {
          system,
          modules,
        }:
        nixpkgs.lib.nixosSystem {
          inherit system;
          modules = modules ++ [
            {
              nixpkgs.hostPlatform = system;
              nixpkgs.config.allowUnfree = true;
            }
          ];
        };
      mkConfiguredStableSystem =
        {
          system,
          modules,
        }:
        nixpkgs-stable.lib.nixosSystem {
          inherit system;
          modules = modules ++ [
            {
              nixpkgs.hostPlatform = system;
              nixpkgs.config.allowUnfree = true;
            }
          ];
        };
    in
    assert lib.hasInfix
      "NIXPI_STABLE_NIXOS_RELEASE=\"\${NIXPI_STABLE_NIXOS_RELEASE:-${stableNixOSRelease}}\""
      installFinalizeSystemFlakeScript;
    assert lib.hasInfix "nixpkgs-stable.url = \"${stableNixpkgsFlakeUrl}\";" flakeSource;
    {
      packages = forAllSystems (
        system:
        mkPackages system
      );

      formatter = forAllSystems (system: (mkPkgs system).nixfmt-rfc-style);

      nixosModules = {
        # Minimal installed NixPI base without the Pi runtime, collab stack,
        # desktop shell, or operator tooling bundle.
        nixpi-base-no-shell =
          { ... }:
          {
            imports = moduleSets.nixpiBaseNoShell;
          };

        # Minimal installed NixPI base with the operator shell path.
        nixpi-base =
          { ... }:
          {
            imports = moduleSets.nixpiBase;
          };

        # Portable NixPI module set without the operator shell/user module.
        # Useful for tests that intentionally define their own primary user.
        nixpi-no-shell =
          { ... }:
          {
            imports = moduleSets.nixpiNoShell;
          };

        # Single composable module exporting all NixPI feature modules.
        nixpi =
          { ... }:
          {
            imports = moduleSets.nixpi;
            # allowUnfree is intentionally NOT set here.
            # nixpkgs.config cannot be set in a module that is used inside
            # pkgs.testers.nixosTest (the test framework injects an externally
            # created pkgs, making the NixOS module system reject nixpkgs.config
            # overrides).  Consuming configurations set allowUnfree themselves.
          };

      };

      nixosConfigurations = {
        # Canonical NixPI headless VPS profile used for local builds and CI topology checks.
        vps = mkConfiguredSystem {
          inherit system;
          modules = [ ./core/os/hosts/vps.nix ];
        };

        ovh-vps = mkConfiguredStableSystem {
          inherit system;
          modules = [
            disko.nixosModules.disko
            ./core/os/disko/ovh-single-disk.nix
            ./core/os/hosts/ovh-vps.nix
          ];
        };

        # Host-owned system-flake composition used by the retained install-finalize path:
        # local /etc/nixos configuration layered with nixpi.nixosModules.nixpi.
        # Used by checks.config and checks.boot below.
        installed-test = mkConfiguredSystem {
          inherit system;
          modules = [
            self.nixosModules.nixpi
            {
              nixpi.primaryUser = "alex";
              networking.hostName = "nixos";
              system.stateVersion = "25.05";
              boot.loader = {
                systemd-boot.enable = true;
                efi.canTouchEfiVariables = true;
              };
              fileSystems = {
                "/" = {
                  device = "/dev/vda";
                  fsType = "ext4";
                };
                "/boot" = {
                  device = "/dev/vda1";
                  fsType = "vfat";
                };
              };
            }
          ];
        };
      };

      checks.${system} =
        let
          setupApplyPackage = self.packages.${system}.nixpi-setup-apply;
          generatedModuleSystem = mkConfiguredSystem {
            inherit system;
            modules = [
              self.nixosModules.nixpi
              {
                nixpi.primaryUser = "pi";
                networking.hostName = "generated-module-test";
                system.stateVersion = "25.05";
                boot.loader.systemd-boot.enable = true;
                boot.loader.efi.canTouchEfiVariables = true;
                fileSystems."/" = {
                  device = "/dev/vda";
                  fsType = "ext4";
                };
                fileSystems."/boot" = {
                  device = "/dev/vda1";
                  fsType = "vfat";
                };
              }
            ];
          };
          # Import the NixOS integration test suite
          # Using pkgsUnfree so tests can use packages that require allowUnfree
          nixosTests = import ./tests/nixos {
            pkgs = pkgsUnfree;
            inherit lib self;
          };
          bootCheck = pkgsUnfree.testers.runNixOSTest {
            name = "boot";

            nodes.nixpi =
              { ... }:
              {
                imports = [
                  self.nixosModules.nixpi
                ];

                nixpi.primaryUser = "alex";

                networking.hostName = "nixos";
                system.stateVersion = "25.05";
                boot.loader.systemd-boot.enable = true;
                boot.loader.efi.canTouchEfiVariables = true;
                fileSystems."/" = {
                  device = "/dev/vda";
                  fsType = "ext4";
                };
                fileSystems."/boot" = {
                  device = "/dev/vda1";
                  fsType = "vfat";
                };

                # Give the VM enough disk for the NixPI closure
                virtualisation.diskSize = 20480; # 20 GB
                virtualisation.memorySize = 4096;
              };

            testScript = ''
              nixpi = machines[0]

              nixpi.start()
              nixpi.wait_for_unit("multi-user.target", timeout=300)

              # Basic sanity: the default operator exists and the core service surface is installed
              nixpi.succeed("id alex")

              # NetworkManager is running
              nixpi.succeed("systemctl is-active NetworkManager")
            '';
          };
          mkCheckLane = name: entries: pkgs.linkFarm name entries;
        in
        {
          exported-topology =
            assert builtins.hasAttr "aarch64-linux" self.packages;
            assert builtins.hasAttr "nixpi-app-setup" generatedModuleSystem.config.systemd.services;
            pkgs.runCommandLocal "exported-topology-check" { } ''
              touch "$out"
            '';

          # Fast: build the installed system closure locally — catches locale
          # errors, module conflicts, bad package references, and NixOS
          # evaluation failures without touching QEMU.
          config = self.nixosConfigurations.installed-test.config.system.build.toplevel;

          # Fast stable-path proof for the retained system-flake contract.
          config-stable-system-flake =
            (
              mkConfiguredStableSystem {
                inherit system;
                modules = [
                  self.nixosModules.nixpi
                  {
                    nixpi.primaryUser = "alex";
                    networking.hostName = "nixos";
                    system.stateVersion = "25.05";
                    boot.loader = {
                      systemd-boot.enable = true;
                      efi.canTouchEfiVariables = true;
                    };
                    fileSystems = {
                      "/" = {
                        device = "/dev/vda";
                        fsType = "ext4";
                      };
                      "/boot" = {
                        device = "/dev/vda1";
                        fsType = "vfat";
                      };
                    };
                  }
                ];
              }
            ).config.system.build.toplevel;

          install-finalize-stable-alignment = pkgs.runCommandLocal "install-finalize-stable-alignment-check" { } ''
            expected_default='NIXPI_STABLE_NIXOS_RELEASE="''${NIXPI_STABLE_NIXOS_RELEASE:-${stableNixOSRelease}}"'
            grep -F "$expected_default" ${./core/scripts/nixpi-init-system-flake.sh} >/dev/null
            expected_flake_url='nixpkgs-stable.url = "${stableNixpkgsFlakeUrl}";'
            grep -F "$expected_flake_url" ${./flake.nix} >/dev/null
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
            ! grep -F 'SUDO_USER:-human' "${./core/scripts/nixpi-setup-apply.sh}"
            touch "$out"
          '';

          rebuild-pull-script = pkgs.runCommandLocal "rebuild-pull-script-check" { } ''
            script="${./.}/core/scripts/nixpi-rebuild-pull.sh"
            test -x "$script"
            grep -F 'REPO_DIR="/srv/nixpi"' "$script" >/dev/null
            grep -F 'TARGET_REF="''${1:-main}"' "$script" >/dev/null
            grep -F 'reset --hard "origin/$TARGET_REF"' "$script" >/dev/null
            grep -F 'nixos-rebuild switch --flake /etc/nixos#nixos' "$script" >/dev/null
            touch "$out"
          '';

          system-flake-finalize = pkgs.runCommandLocal "system-flake-finalize-check" { } ''
            script=${./core/scripts/nixpi-install-finalize.sh}
            helper=${./core/scripts/nixpi-init-system-flake.sh}
            test -x "$script"
            test -x "$helper"
            grep -F 'core/scripts/nixpi-init-system-flake.sh' "$script" >/dev/null
            grep -F 'git clone --branch "$REPO_BRANCH" "$REPO_URL" "$REPO_DIR"' "$script" >/dev/null
            grep -F 'NIXPI_NIXPKGS_FLAKE_URL' "$helper" >/dev/null
            grep -F 'NIXPI_STABLE_NIXOS_RELEASE' "$helper" >/dev/null
            grep -F '# Generated by NixPI install finalization' "$helper" >/dev/null
            grep -F 'nixpi.inputs.nixpkgs.follows = "nixpkgs";' "$helper" >/dev/null
            grep -F 'nixosConfigurations.nixos' "$helper" >/dev/null
            grep -F './configuration.nix' "$helper" >/dev/null
            ! grep -F 'specialArgs =' "$helper" >/dev/null
            ! grep -F 'nixpi-integration.nix' "$helper" >/dev/null
            ! grep -F 'nixpi-host.nix' "$helper" >/dev/null
            ! grep -F 'hostModules' "$helper" >/dev/null
            ! grep -F 'Host-owned NixOS flake with NixPI layered on top' "$helper" >/dev/null
            ! grep -F 'nixos-rebuild switch --flake /srv/nixpi#nixpi' "$script" >/dev/null
            ! grep -F 'github:NixOS/nixpkgs/nixos-unstable' "$helper" >/dev/null
            touch "$out"
          '';

          flake-topology = pkgs.runCommandLocal "flake-topology-check" { } ''
            ! grep -F 'desktop-vm' ${./flake.nix}
            ! test -e ${./.}/core/os/hosts/x86_64-vm.nix
            ! test -e ${./.}/tools/run-qemu.sh
            ! test -e ${./.}/core/os/hosts/rpi-common.nix
            ! test -e ${./.}/core/os/hosts/rpi4.nix
            ! test -e ${./.}/core/os/hosts/rpi5.nix
            touch "$out"
          '';

          vps-topology = pkgs.runCommandLocal "vps-topology-check" { } ''
            grep -F 'nixosConfigurations.vps' ${./flake.nix} >/dev/null
            ! grep -F 'nixosConfigurations.rpi4' ${./flake.nix} >/dev/null
            ! grep -F 'nixosConfigurations.rpi5' ${./flake.nix} >/dev/null
            ! grep -F 'nixosConfigurations.nixpi = self.nixosConfigurations.vps' ${./flake.nix} >/dev/null
            ! grep -F 'Managed NixPI desktop profile' ${./flake.nix} >/dev/null
            grep -F './core/os/hosts/vps.nix' ${./flake.nix} >/dev/null
            ! grep -F 'primaryUser = lib.mkDefault "human";' ${./core/os/hosts/vps.nix} >/dev/null
            grep -F 'headless VPS profile' ${./core/os/hosts/vps.nix} >/dev/null
            grep -F 'enableRedistributableFirmware' ${./core/os/hosts/vps.nix} >/dev/null
            sed -n '/nixosConfigurations.installed-test =/,/checks\.\${system} =/p' ${./flake.nix} \
              | grep -F 'self.nixosModules.nixpi' >/dev/null
            sed -n '/bootCheck = pkgsUnfree.testers.runNixOSTest {/,/mkCheckLane = name: entries:/p' ${./flake.nix} \
              | grep -F 'self.nixosModules.nixpi' >/dev/null
            smoke_block="$(sed -n '/nixos-smoke = mkCheckLane "nixos-smoke" \[/,/nixos-full = mkCheckLane "nixos-full" \[/p' ${./flake.nix})"
            ! printf '%s\n' "$smoke_block" | grep -F 'name = "nixpi-vps-bootstrap";' >/dev/null
            printf '%s\n' "$smoke_block" | grep -F 'name = "nixpi-runtime";' >/dev/null
            printf '%s\n' "$smoke_block" | grep -F 'name = "nixpi-security";' >/dev/null
            printf '%s\n' "$smoke_block" | grep -F 'name = "nixpi-broker";' >/dev/null
            runtime_line="$(printf '%s\n' "$smoke_block" | grep -nF 'name = "nixpi-runtime";' | cut -d: -f1)"
            security_line="$(printf '%s\n' "$smoke_block" | grep -nF 'name = "nixpi-security";' | cut -d: -f1)"
            broker_line="$(printf '%s\n' "$smoke_block" | grep -nF 'name = "nixpi-broker";' | cut -d: -f1)"
            test "$runtime_line" -lt "$security_line"
            test "$security_line" -lt "$broker_line"
            grep -F 'enableRedistributableFirmware' ${./core/os/hosts/vps.nix} >/dev/null
            touch "$out"
          '';

          vps-console-config = pkgs.runCommandLocal "vps-console-config-check" { } ''
            params='${lib.concatStringsSep " " self.nixosConfigurations.vps.config.boot.kernelParams}'
            printf '%s\n' "$params" | grep -Eq '(^| )console=tty0($| )'
            printf '%s\n' "$params" | grep -Eq '(^| )console=ttyS0,115200($| )'
            test '${
              if self.nixosConfigurations.vps.config.systemd.services."getty@tty1".enable then "true" else "false"
            }' = true
            touch "$out"
          '';

          # Thorough: boot the installed system in a NixOS test VM and verify
          # that critical services come up.
          boot = bootCheck;

          nixos-smoke = mkCheckLane "nixos-smoke" [
            {
              name = "nixpi-runtime";
              path = nixosTests.nixpi-runtime;
            }
            {
              name = "nixpi-security";
              path = nixosTests.nixpi-security;
            }
            {
              name = "nixpi-wireguard";
              path = nixosTests.nixpi-wireguard;
            }
            {
              name = "nixpi-broker";
              path = nixosTests.nixpi-broker;
            }
          ];

          nixos-full = mkCheckLane "nixos-full" [
            {
              name = "boot";
              path = bootCheck;
            }
            {
              name = "nixpi-firstboot";
              path = nixosTests.nixpi-firstboot;
            }
            {
              name = "nixpi-system-flake";
              path = nixosTests.nixpi-system-flake;
            }
            {
              name = "nixpi-network";
              path = nixosTests.nixpi-network;
            }
            {
              name = "nixpi-e2e";
              path = nixosTests.nixpi-e2e;
            }
            {
              name = "nixpi-security";
              path = nixosTests.nixpi-security;
            }
            {
              name = "nixpi-wireguard";
              path = nixosTests.nixpi-wireguard;
            }
            {
              name = "nixpi-modular-services";
              path = nixosTests.nixpi-modular-services;
            }
            {
              name = "nixpi-post-setup-lockdown";
              path = nixosTests.nixpi-post-setup-lockdown;
            }
            {
              name = "nixpi-broker";
              path = nixosTests.nixpi-broker;
            }
            {
              name = "nixpi-update";
              path = nixosTests.nixpi-update;
            }
            {
              name = "nixpi-options-validation";
              path = nixosTests.nixpi-options-validation;
            }
          ];

          nixos-destructive = mkCheckLane "nixos-destructive" [
            {
              name = "nixpi-post-setup-lockdown";
              path = nixosTests.nixpi-post-setup-lockdown;
            }
            {
              name = "nixpi-broker";
              path = nixosTests.nixpi-broker;
            }
          ];
        }
        // nixosTests; # Merge in the new test suite

      apps.${system} = {
        nixpi-deploy-ovh = {
          type = "app";
          program = "${self.packages.${system}.nixpi-deploy-ovh}/bin/nixpi-deploy-ovh";
        };
      };

      devShells = forAllSystems (
        system:
        let
          pkgs = mkPkgs system;
        in
        {
          default = pkgs.mkShell {
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
        }
      );
    };
}
