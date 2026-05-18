{
  description = "Nazar Minecraft MicroVM service module";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems f;
    in
    {
      nixosModules = rec {
        minecraft-service = ./nix/modules/minecraft-papermc.nix;
        minecraft-web = ./nix/modules/minecraft-web.nix;
        minecraft-microvm = ./nix/hosts/minecraft/default.nix;
        minecraft = minecraft-microvm;
        default = minecraft-microvm;
      };

      packages = forAllSystems (_system: { });
      checks = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          testSystem = nixpkgs.lib.nixosSystem {
            inherit system;
            specialArgs = {
              vm = {
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
            modules = [ self.nixosModules.minecraft-service ];
          };
        in
        {
          module-eval = pkgs.runCommand "minecraft-module-eval" { } ''
            mkdir -p $out
            echo ${toString testSystem.config.services.minecraft-server.serverProperties.server-port} > $out/server-port
          '';
        }
      );
    };
}
