{
  description = "Nazar NixOS host services";

  nixConfig = {
    extra-substituters = [ "https://cache.numtide.com" ];
    extra-trusted-public-keys = [ "niks3.numtide.com-1:DTx8wZduET09hRmMtKdQDxNNthLQETkc/yaX7M4qK0g=" ];
  };

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    hermes-agent.url = "github:NousResearch/hermes-agent";

    # Keep llm-agents on its pinned nixpkgs so Numtide's binary cache hits and
    # agent packages do not need to rebuild against the host nixpkgs input.
    llm-agents.url = "github:numtide/llm-agents.nix";

    disko = {
      url = "github:nix-community/disko";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    inputs@{
      self,
      nixpkgs,
      ...
    }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      fleet = import ./nix/fleet/services.nix;

      nixosModules = rec {
        nazar = ./nix/hosts/nazar;
        alex-laptop = ./nix/hosts/alex-laptop;
        default = nazar;
      };

      mkNixosSystem =
        module:
        nixpkgs.lib.nixosSystem {
          inherit system;
          specialArgs = {
            inherit inputs fleet;
          };
          modules = [ module ];
        };

      mkSwitchProgram =
        name:
        pkgs.writeShellApplication {
          name = "nazar-switch-${name}";
          runtimeInputs = [
            pkgs.nixos-rebuild
            pkgs.systemd
          ];
          text = ''
            set -euo pipefail

            if [ "$EUID" -ne 0 ]; then
              exec sudo "$0" "$@"
            fi

            if [ "''${NAZAR_SWITCH_SYSTEMD_RUN:-0}" != "1" ] && grep -Eq 'hermes-agent\.service' /proc/self/cgroup; then
              unit="nazar-switch-${name}-$(date +%s)"
              echo "==> detected agent service context; continuing rebuild in transient systemd unit $unit"
              exec systemd-run \
                --unit="$unit" \
                --collect \
                --wait \
                --pipe \
                --property=Type=exec \
                --working-directory="$(pwd -P)" \
                --setenv=NAZAR_SWITCH_SYSTEMD_RUN=1 \
                "$0" "$@"
            fi

            nixos-rebuild switch --flake ${self.outPath}#nazar "$@"
          '';
        };
      mkSwitchApp = name: description: {
        type = "app";
        program = "${mkSwitchProgram name}/bin/nazar-switch-${name}";
        meta.description = description;
      };
    in
    {
      inherit nixosModules;

      nixosConfigurations = {
        nazar = mkNixosSystem nixosModules.nazar;
        alex-laptop = mkNixosSystem nixosModules.alex-laptop;
      };

      packages.${system} = rec {
        hermes-agent = inputs.hermes-agent.packages.${system}.default;
        life = pkgs.callPackage ./packages/life-os/package.nix { };
        life-os = life;
        default = life;
      };

      apps.${system} = {
        default = mkSwitchApp "host" "Switch the Nazar host configuration";
        switch = mkSwitchApp "host" "Switch the Nazar host configuration";
        switch-host = mkSwitchApp "host" "Switch the Nazar host configuration";
      };

      checks.${system} = {
        life-os-package = self.packages.${system}.life-os;
        life-os-tests = pkgs.runCommand "life-os-tests" { nativeBuildInputs = [ pkgs.bun ]; } ''
          cp -R ${./packages/life-os} ./life-os
          chmod -R u+w ./life-os
          cd ./life-os
          bun test
          mkdir -p $out
          touch $out/passed
        '';
        nazar-host-module-eval = pkgs.runCommand "nazar-host-module-eval" { } ''
          mkdir -p $out

          assert_true() {
            name="$1"
            value="$2"
            echo "$value" > "$out/$name"
            if [ "$value" != "1" ]; then
              echo "nazar-host-module-eval failed: $name expected 1, got $value" >&2
              exit 1
            fi
          }

          assert_equals() {
            name="$1"
            actual="$2"
            expected="$3"
            echo "$actual" > "$out/$name"
            if [ "$actual" != "$expected" ]; then
              echo "nazar-host-module-eval failed: $name expected $expected, got $actual" >&2
              exit 1
            fi
          }

          assert_true openssh-enabled ${toString self.nixosConfigurations.nazar.config.services.openssh.enable}
          assert_true hermes-dashboard-enabled ${
            toString (self.nixosConfigurations.nazar.config.systemd.services.hermes-dashboard.enable or false)
          }
          assert_true hermes-dashboard-wanted ${
            toString (
              nixpkgs.lib.elem "multi-user.target" (
                self.nixosConfigurations.nazar.config.systemd.services.hermes-dashboard.wantedBy or [ ]
              )
            )
          }
          assert_equals hermes-dashboard-restart ${self.nixosConfigurations.nazar.config.systemd.services.hermes-dashboard.serviceConfig.Restart} always
          assert_true tailscale-enabled ${toString self.nixosConfigurations.nazar.config.services.tailscale.enable}
          assert_true tailscale-open-firewall ${toString self.nixosConfigurations.nazar.config.services.tailscale.openFirewall}
          assert_true tailscale-private-http-allowed ${
            toString (
              nixpkgs.lib.elem 80 (
                self.nixosConfigurations.nazar.config.networking.firewall.interfaces.tailscale0.allowedTCPPorts
                  or [ ]
              )
            )
          }
          assert_true tailscale-private-https-allowed ${
            toString (
              nixpkgs.lib.elem 443 (
                self.nixosConfigurations.nazar.config.networking.firewall.interfaces.tailscale0.allowedTCPPorts
                  or [ ]
              )
            )
          }
          assert_true public-http-not-globally-allowed ${
            toString (
              !(nixpkgs.lib.elem 80 (
                self.nixosConfigurations.nazar.config.networking.firewall.allowedTCPPorts or [ ]
              ))
            )
          }
          assert_true public-https-not-globally-allowed ${
            toString (
              !(nixpkgs.lib.elem 443 (
                self.nixosConfigurations.nazar.config.networking.firewall.allowedTCPPorts or [ ]
              ))
            )
          }
          assert_true tailscale-not-trusted-interface ${
            toString (
              !(nixpkgs.lib.elem "tailscale0" (
                self.nixosConfigurations.nazar.config.networking.firewall.trustedInterfaces or [ ]
              ))
            )
          }
        '';
        alex-laptop-tunnel-module-eval = pkgs.runCommand "alex-laptop-tunnel-module-eval" { } ''
          mkdir -p $out
          echo ${toString self.nixosConfigurations.alex-laptop.config.nazar.access.tunnel.enable} > $out/nazar-tunnel-option-enabled
          echo ${
            toString (self.nixosConfigurations.alex-laptop.config.systemd.services.nazar-tunnel.enable or false)
          } > $out/nazar-tunnel-service-enabled
          echo ${
            toString (
              nixpkgs.lib.elem "multi-user.target" (
                self.nixosConfigurations.alex-laptop.config.systemd.services.nazar-tunnel.wantedBy or [ ]
              )
            )
          } > $out/nazar-tunnel-wanted
          echo ${self.nixosConfigurations.alex-laptop.config.systemd.services.nazar-tunnel.serviceConfig.Restart} > $out/nazar-tunnel-restart
        '';
      };

      devShells.${system} = {
        default = pkgs.mkShell {
          packages = [
            pkgs.bun
            pkgs.nixos-rebuild
          ];
        };
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
