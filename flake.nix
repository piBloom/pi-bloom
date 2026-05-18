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
      nixpi-bun = pkgs.callPackage ./services/nixpi/nix/packages/nixpi-bun { };
      fleet = import ./nix/fleet/services.nix;

      nixosModules = rec {
        nazar = ./nix/hosts/nazar;
        alex-laptop = ./nix/hosts/alex-laptop;
        default = nazar;

        dav-server = ./services/dav-server/nix/modules/dav-server.nix;
        dav-server-service = dav-server;

        nixpi-bun = ./services/nixpi/nix/modules/nixpi-bun.nix;
        nixpi-bun-service = nixpi-bun;

        minecraft = ./services/minecraft/nix/modules/minecraft-papermc.nix;
        minecraft-service = minecraft;
        minecraft-web = ./services/minecraft/nix/modules/minecraft-web.nix;
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

      nixosConfigurations = {
        nazar = mkNixosSystem nixosModules.nazar;
        alex-laptop = mkNixosSystem nixosModules.alex-laptop;
      };

      packages.${system} = {
        inherit pi nixpi-bun;
      };

      apps.${system} = {
        default = mkSwitchApp "host" "Switch the Nazar host configuration";
        switch = mkSwitchApp "host" "Switch the Nazar host configuration";
        switch-host = mkSwitchApp "host" "Switch the Nazar host configuration";
        switch-minecraft = mkSwitchApp "minecraft" "Switch the Nazar host configuration for the host Minecraft service";
        switch-dav-server = mkSwitchApp "dav-server" "Switch the Nazar host configuration for the host DAV service";
      };

      checks.${system} =
        let
          minecraftTestSystem = nixpkgs.lib.nixosSystem {
            inherit system;
            specialArgs = {
              minecraftContext = {
                service = "minecraft";
                dns = "mc.example.invalid";
                minecraft = {
                  operators = [
                    {
                      name = "ExampleOp";
                      uuid = "00000000-0000-0000-0000-000000000001";
                    }
                  ];
                  gameRules.keep_inventory = true;
                  pluginConfigs."voicechat/voicechat-server.properties" = ''
                    port=24454
                    allow_pings=true
                  '';
                  rcon = {
                    enable = true;
                    passwordFile = builtins.toFile "minecraft-rcon-password-test" "not-a-real-secret\n";
                  };
                };
              };
            };
            modules = [ nixosModules.minecraft ];
          };

          davServerTestSystem = nixpkgs.lib.nixosSystem {
            inherit system;
            specialArgs = {
              davServerContext = {
                service = "dav-server";
                dns = "dav.example.invalid";
                davServer = {
                  listenAddress = "127.0.0.1";
                  nginxDefault = false;
                  radicalePort = 5232;
                  httpPort = 8080;
                  auth.enable = false;
                };
              };
            };
            modules = [ nixosModules.dav-server ];
          };
        in
        {
          inherit nixpi-bun;

          minecraft-module-eval = pkgs.runCommand "minecraft-module-eval" { } ''
            mkdir -p $out
            echo ${toString minecraftTestSystem.config.services.minecraft-server.serverProperties.server-port} > $out/server-port
          '';

          dav-server-module-eval = pkgs.runCommand "dav-server-module-eval" { } ''
            mkdir -p $out
            echo ${toString davServerTestSystem.config.services.radicale.enable} > $out/radicale-enabled
          '';
        };

      devShells.${system} = {
        default = pkgs.mkShell {
          packages = [ pkgs.nixos-rebuild ];
        };

        nixpi = pkgs.mkShell {
          packages = [
            pkgs.bun
            pkgs.nodejs_22
            pkgs.chromium
            pkgs.gnumake
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
          find flake.nix nix services -type f -name '*.nix' -print0 \
            | xargs -0 --no-run-if-empty nixfmt
        '';
      };
    };
}
