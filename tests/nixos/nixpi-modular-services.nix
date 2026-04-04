{ lib, nixPiModulesNoShell, piAgent, appPackage, mkTestFilesystems, ... }:

{
  name = "nixpi-modular-services";

  nodes.nixpi = { pkgs, ... }: let
    username = "pi";
    homeDir = "/home/${username}";
  in {
    imports = nixPiModulesNoShell ++ [ mkTestFilesystems ];
    _module.args = { inherit piAgent appPackage; };
    nixpi.primaryUser = username;

    networking.hostName = "nixpi-modular-test";

    users.users.${username} = {
      isNormalUser = true;
      group = username;
      extraGroups = [ "wheel" "networkmanager" ];
      home = homeDir;
      shell = pkgs.bash;
    };
    users.groups.${username} = {};

  };

  testScript = ''
    nixpi = machines[0]

    nixpi.start()
    nixpi.wait_for_unit("multi-user.target", timeout=300)

    nixpi.wait_until_succeeds("curl -skf https://127.0.0.1/ | grep -q 'NixPI'", timeout=60)

    print("NixPI modular service tests passed!")
  '';
}
