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
          assert_true nginx-enabled ${toString self.nixosConfigurations.nazar.config.services.nginx.enable}
          assert_true life-os-webdav-location ${
            toString (
              self.nixosConfigurations.nazar.config.services.nginx.virtualHosts."life-os-private".locations
              ? "/life/"
            )
          }
          assert_true radicale-enabled ${toString self.nixosConfigurations.nazar.config.services.radicale.enable}
          assert_true radicale-init-enabled ${
            toString (
              self.nixosConfigurations.nazar.config.systemd.services.life-os-radicale-init.enable or false
            )
          }
          assert_equals radicale-storage ${self.nixosConfigurations.nazar.config.services.radicale.settings.storage.filesystem_folder} /var/lib/radicale/collections
          assert_true radicale-tailscale-port-allowed ${
            toString (
              nixpkgs.lib.elem 5232 (
                self.nixosConfigurations.nazar.config.networking.firewall.interfaces.tailscale0.allowedTCPPorts
                  or [ ]
              )
            )
          }
          assert_true radicale-port-not-globally-allowed ${
            toString (
              !(nixpkgs.lib.elem 5232 (
                self.nixosConfigurations.nazar.config.networking.firewall.allowedTCPPorts or [ ]
              ))
            )
          }
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

          assert_true() {
            name="$1"
            value="$2"
            echo "$value" > "$out/$name"
            if [ "$value" != "1" ]; then
              echo "alex-laptop-tunnel-module-eval failed: $name expected 1, got $value" >&2
              exit 1
            fi
          }

          assert_equals() {
            name="$1"
            actual="$2"
            expected="$3"
            echo "$actual" > "$out/$name"
            if [ "$actual" != "$expected" ]; then
              echo "alex-laptop-tunnel-module-eval failed: $name expected $expected, got $actual" >&2
              exit 1
            fi
          }

          assert_true nazar-tunnel-option-enabled ${toString self.nixosConfigurations.alex-laptop.config.nazar.access.tunnel.enable}
          assert_true nazar-tunnel-service-enabled ${
            toString (self.nixosConfigurations.alex-laptop.config.systemd.services.nazar-tunnel.enable or false)
          }
          assert_true nazar-tunnel-wanted ${
            toString (
              nixpkgs.lib.elem "multi-user.target" (
                self.nixosConfigurations.alex-laptop.config.systemd.services.nazar-tunnel.wantedBy or [ ]
              )
            )
          }
          assert_equals nazar-tunnel-restart ${self.nixosConfigurations.alex-laptop.config.systemd.services.nazar-tunnel.serviceConfig.Restart} always
          assert_true tailscale-enabled ${toString self.nixosConfigurations.alex-laptop.config.services.tailscale.enable}
          assert_true tailscale-open-firewall ${toString self.nixosConfigurations.alex-laptop.config.services.tailscale.openFirewall}
          assert_equals tailscale-routing-features ${self.nixosConfigurations.alex-laptop.config.services.tailscale.useRoutingFeatures} client
          assert_true life-os-client-enabled ${toString self.nixosConfigurations.alex-laptop.config.nazar.lifeOs.client.enable}
          assert_true life-os-client-davfs2-enabled ${toString self.nixosConfigurations.alex-laptop.config.services.davfs2.enable}
          assert_equals life-os-client-dav-url ${self.nixosConfigurations.alex-laptop.config.nazar.lifeOs.client.davUrl} http://100.92.138.94/life/
          assert_equals life-os-client-caldav-url ${self.nixosConfigurations.alex-laptop.config.nazar.lifeOs.client.caldav.url} http://100.92.138.94:5232/
          assert_true life-os-client-vdirsyncer-enabled ${toString self.nixosConfigurations.alex-laptop.config.services.vdirsyncer.enable}
          assert_true life-os-client-vdirsyncer-job ${
            toString (self.nixosConfigurations.alex-laptop.config.services.vdirsyncer.jobs ? life-os)
          }
          assert_true life-os-client-kde-apps-enabled ${toString self.nixosConfigurations.alex-laptop.config.nazar.lifeOs.client.kdeApps.enable}
          assert_true life-os-client-thunderbird-enabled ${toString self.nixosConfigurations.alex-laptop.config.nazar.lifeOs.client.thunderbird.enable}
          assert_equals life-os-client-mount-fstype ${
            self.nixosConfigurations.alex-laptop.config.fileSystems."/home/alex/LifeOS".fsType
          } davfs
          assert_true life-os-client-mount-automount ${
            toString (
              nixpkgs.lib.elem "x-systemd.automount" (
                self.nixosConfigurations.alex-laptop.config.fileSystems."/home/alex/LifeOS".options or [ ]
              )
            )
          }
          assert_true life-os-client-mount-netdev ${
            toString (
              nixpkgs.lib.elem "_netdev" (
                self.nixosConfigurations.alex-laptop.config.fileSystems."/home/alex/LifeOS".options or [ ]
              )
            )
          }
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
