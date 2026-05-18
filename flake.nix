{
  description = "Nazar NixOS host services";

  nixConfig = {
    extra-substituters = [ "https://cache.numtide.com" ];
    extra-trusted-public-keys = [ "niks3.numtide.com-1:DTx8wZduET09hRmMtKdQDxNNthLQETkc/yaX7M4qK0g=" ];
  };

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

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
      pi = pkgs.callPackage ./nix/packages/pi { };
      fleet = import ./nix/fleet/vms.nix;

      aspectModule = rel: import (./nix/aspects + "/${rel}/default.nix");
      nixosModules = {
        "system-base" = aspectModule "system/base";
        "guest-base" = aspectModule "system/guest-base";
        "development-tools" = aspectModule "development/tools";

        "admin-users" = aspectModule "users/admin";

        "ssh-host-access" = aspectModule "access/ssh-host";
        "private-http-access" = aspectModule "access/private-http";
        "sshuttle-client-access" = aspectModule "access/sshuttle-client";

        "host-networking" = aspectModule "networking/host-uplink";
        "host-firewall" = aspectModule "networking/firewall";
        "service-proxy" = aspectModule "networking/service-proxy";

        "pi-default-packages" = aspectModule "agents/pi-default-packages";
        "host-pi-agent" = aspectModule "agents/pi-agent-host";
        "guest-pi-agent" = aspectModule "agents/pi-agent-guest";
        "llm-agents" = aspectModule "agents/llm-agents";

        "nixpi-host-service" = aspectModule "services/nixpi";
        "code-host-service" = aspectModule "services/code";
        "dav-server-host-service" = aspectModule "services/dav-server";
        "minecraft-host-service" = aspectModule "services/minecraft";

        "backup-inventory" = aspectModule "storage/backup";
        "host-monitoring" = aspectModule "monitoring/mdraid-smart";

        "profile-host-production" = aspectModule "profiles/host-production";
        "profile-client-alex-laptop" = aspectModule "profiles/client-alex-laptop";

        "dav-server-service" = import ./services/dav-server/nix/modules/dav-server.nix;
        "nixpi-bun-service" = import ./services/nixpi/nix/modules/nixpi-bun.nix;
        "minecraft-service" = import ./services/minecraft/nix/modules/minecraft-papermc.nix;
        "minecraft-web" = import ./services/minecraft/nix/modules/minecraft-web.nix;
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

            if [ "''${NAZAR_SWITCH_SYSTEMD_RUN:-0}" != "1" ] && grep -Eq 'nixpi(-bun)?\.service' /proc/self/cgroup; then
              unit="nazar-switch-${name}-$(date +%s)"
              echo "==> detected NixPi service context; continuing rebuild in transient systemd unit $unit"
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

      modules.nixos = nixosModules;

      nixosConfigurations = {
        nazar = mkNixosSystem nixosModules."profile-host-production";
        alex-laptop = mkNixosSystem nixosModules."profile-client-alex-laptop";
      };

      packages.${system} = {
        inherit pi;
      };

      apps.${system} = {
        default = mkSwitchApp "host" "Switch the Nazar host configuration";
        switch = mkSwitchApp "host" "Switch the Nazar host configuration";
        switch-host = mkSwitchApp "host" "Switch the Nazar host configuration";
        switch-minecraft = mkSwitchApp "minecraft" "Switch the Nazar host configuration for the host Minecraft service";
        switch-dav-server = mkSwitchApp "dav-server" "Switch the Nazar host configuration for the host DAV service";
      };

      checks.${system} = { };

      devShells.${system}.default = pkgs.mkShell {
        packages = [ pkgs.nixos-rebuild ];
      };

      formatter.${system} = pkgs.writeShellApplication {
        name = "nazar-fmt";
        runtimeInputs = [
          pkgs.findutils
          pkgs.nixfmt
        ];
        text = ''
          find flake.nix nix services -type f -name '*.nix' -print0 \
            | xargs -0 --no-run-if-empty nixfmt
        '';
      };
    };
}
