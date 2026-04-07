# flake.nix
{
  description = "NixPI — Pi-native AI companion OS on NixOS";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    {
      self,
      nixpkgs,
      ...
    }:
    let
      system = "x86_64-linux";
      inherit (nixpkgs) lib;
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
          nixpi-bootstrap-vps = pkgs.callPackage ./core/os/pkgs/bootstrap { };
          nixpi-rebuild = pkgs.callPackage ./core/os/pkgs/nixpi-rebuild { };
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
    in
    {
      packages = forAllSystems (
        system:
        (mkPackages system)
        // {
          nixpi-bootstrap-fresh-install-harness =
            self.checks.${system}.nixpi-bootstrap-fresh-install-external.driver;
        }
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

        # Minimal installed NixPI base with the operator shell/bootstrap path.
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

        # Host-owned system-flake composition used by bootstrap-generated installs:
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
          bootstrapPackage = self.packages.${system}.nixpi-bootstrap-vps;
          bootstrapScriptSource = ./core/os/pkgs/bootstrap/nixpi-bootstrap-vps.sh;
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
            assert builtins.hasAttr "nixpi-ttyd" generatedModuleSystem.config.systemd.services;
            pkgs.runCommandLocal "exported-topology-check" { } ''
              touch "$out"
            '';

          # Fast: build the installed system closure locally — catches locale
          # errors, module conflicts, bad package references, and NixOS
          # evaluation failures without touching QEMU.
          config = self.nixosConfigurations.installed-test.config.system.build.toplevel;

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

          bootstrap-script = pkgs.runCommandLocal "bootstrap-script-check" { } ''
            test -x "${bootstrapPackage}/bin/nixpi-bootstrap-vps"
            test -x "${bootstrapScriptSource}"
            test -x "${./core/scripts/nixpi-init-system-flake.sh}"
            test -x "${./core/scripts/nixpi-rebuild.sh}"
            grep -F 'REPO_DIR="/srv/nixpi"' "${bootstrapScriptSource}" >/dev/null
            grep -F 'REPO_URL="''${NIXPI_REPO_URL:-https://github.com/alexradunet/nixpi.git}"' "${bootstrapScriptSource}" >/dev/null
            grep -F 'BRANCH="''${NIXPI_REPO_BRANCH:-main}"' "${bootstrapScriptSource}" >/dev/null
            grep -F '/srv/nixpi' "${bootstrapScriptSource}" >/dev/null
            grep -F 'resolve_primary_user()' "${bootstrapScriptSource}" >/dev/null
            grep -F 'id -un' "${bootstrapScriptSource}" >/dev/null
            grep -F 'getent passwd' "${bootstrapScriptSource}" >/dev/null
            ! grep -F 'human' "${bootstrapScriptSource}" >/dev/null
            grep -F 'run_as_root install -d -m 0755 /srv' "${bootstrapScriptSource}" >/dev/null
            grep -F 'run_as_root git clone --branch "$BRANCH" "$REPO_URL" "$REPO_DIR"' "${bootstrapScriptSource}" >/dev/null
            grep -F 'run_as_root git -C "$REPO_DIR" fetch origin "$BRANCH"' "${bootstrapScriptSource}" >/dev/null
            grep -F 'run_as_root git -C "$REPO_DIR" checkout "$BRANCH"' "${bootstrapScriptSource}" >/dev/null
            grep -F 'run_as_root git -C "$REPO_DIR" reset --hard "origin/$BRANCH"' "${bootstrapScriptSource}" >/dev/null
            grep -F 'nixpi-init-system-flake.sh' "${bootstrapScriptSource}" >/dev/null
            grep -F 'nixos-rebuild switch --flake /etc/nixos#nixos' "${bootstrapScriptSource}" >/dev/null
            grep -F 'nixos-rebuild switch --flake /etc/nixos#nixos' "${./core/scripts/nixpi-rebuild.sh}" >/dev/null
            grep -F -- '--impure' "${bootstrapScriptSource}" >/dev/null
            grep -F -- '--impure' "${./core/scripts/nixpi-rebuild.sh}" >/dev/null
            grep -F '"$@"' "${./core/scripts/nixpi-rebuild.sh}" >/dev/null
            grep -F "Use 'nixpi-rebuild' to rebuild" "${bootstrapScriptSource}" >/dev/null
            ! grep -F 'nixos-rebuild switch --flake /srv/nixpi#nixpi' "${bootstrapScriptSource}" >/dev/null
            ! test -e ${./.}/tools/run-installer-iso.sh
            touch "$out"
          '';

          system-flake-bootstrap = pkgs.runCommandLocal "system-flake-bootstrap-check" { } ''
            script=${./core/os/pkgs/bootstrap/nixpi-bootstrap-vps.sh}
            helper=${./core/scripts/nixpi-init-system-flake.sh}
            test -x "$helper"
            grep -F 'core/scripts/nixpi-init-system-flake.sh' "$script" >/dev/null
            grep -F 'NIXPI_NIXPKGS_FLAKE_URL' "$helper" >/dev/null
            grep -F 'NIXPI_STABLE_NIXOS_RELEASE' "$helper" >/dev/null
            grep -F '# Generated by NixPI bootstrap' "$helper" >/dev/null
            grep -F 'nixpi.inputs.nixpkgs.follows = "nixpkgs";' "$helper" >/dev/null
            grep -F 'nixosConfigurations.nixos' "$helper" >/dev/null
            grep -F './configuration.nix' "$helper" >/dev/null
            grep -F 'nixos-rebuild switch --flake /etc/nixos#nixos' "$script" >/dev/null
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
            printf '%s\n' "$smoke_block" | grep -F 'name = "nixpi-chat";' >/dev/null
            printf '%s\n' "$smoke_block" | grep -F 'name = "nixpi-security";' >/dev/null
            printf '%s\n' "$smoke_block" | grep -F 'name = "nixpi-broker";' >/dev/null
            chat_line="$(printf '%s\n' "$smoke_block" | grep -nF 'name = "nixpi-chat";' | cut -d: -f1)"
            security_line="$(printf '%s\n' "$smoke_block" | grep -nF 'name = "nixpi-security";' | cut -d: -f1)"
            broker_line="$(printf '%s\n' "$smoke_block" | grep -nF 'name = "nixpi-broker";' | cut -d: -f1)"
            test "$chat_line" -lt "$security_line"
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
              name = "nixpi-chat";
              path = nixosTests.nixpi-chat;
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
              name = "nixpi-bootstrap-fresh-install";
              path = nixosTests.nixpi-bootstrap-fresh-install;
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

      apps.${system}.nixpi-bootstrap-fresh-install-harness = {
        type = "app";
        program = "${self.packages.${system}.nixpi-bootstrap-fresh-install-harness}/bin/nixos-test-driver";
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
