{
  lib,
  nixPiModulesNoShell,
  mkTestFilesystems,
  ...
}:

{
  name = "nixpi-modular-services";

  nodes.nixpi =
    { pkgs, ... }:
    let
      username = "pi";
      homeDir = "/home/${username}";
    in
    {
      imports = nixPiModulesNoShell ++ [ mkTestFilesystems ];
      nixpi.primaryUser = username;

      networking.hostName = "nixpi-modular-test";

      users.users.${username} = {
        isNormalUser = true;
        group = username;
        extraGroups = [
          "wheel"
          "networkmanager"
        ];
        home = homeDir;
        shell = pkgs.bash;
      };
      users.groups.${username} = { };

    };

  testScript = ''
    nixpi = machines[0]

    nixpi.start()
    nixpi.wait_for_unit("multi-user.target", timeout=300)
    nixpi.wait_for_unit("nixpi-app-setup.service", timeout=120)
    nixpi.succeed("test -f /home/pi/.pi/settings.json")
    nixpi.succeed("command -v pi")

    print("NixPI modular service tests passed!")
  '';
}
