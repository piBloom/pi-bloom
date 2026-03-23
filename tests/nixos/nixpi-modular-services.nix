{ pkgs, lib, nixPiModulesNoShell, piAgent, appPackage, setupPackage, mkTestFilesystems, ... }:

pkgs.testers.runNixOSTest {
  name = "nixpi-modular-services";

  nodes.nixpi = { ... }: let
    username = "pi";
    homeDir = "/home/${username}";
  in {
    imports = nixPiModulesNoShell ++ [ mkTestFilesystems ];
    _module.args = { inherit piAgent appPackage setupPackage; };
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

    nixpi.succeed("test -f /etc/system-services/nixpi-home/webroot/index.html")
    nixpi.succeed("test -f /etc/system-services/nixpi-element-web/config.json")

    nixpi.succeed("grep -q 'NixPI Home' /etc/system-services/nixpi-home/webroot/index.html")
    nixpi.succeed("grep -q 'default_server_config' /etc/system-services/nixpi-element-web/config.json")
    nixpi.succeed("grep -q 'Matrix' /etc/system-services/nixpi-home/webroot/index.html")

    nixpi.succeed("systemctl cat nixpi-home.service | grep -q 'static-web-server'")
    nixpi.succeed("systemctl cat nixpi-element-web.service | grep -q 'static-web-server'")
    nixpi.succeed("systemctl show -p NoNewPrivileges --value nixpi-home.service | grep -q yes")
    nixpi.succeed("systemctl show -p ProtectSystem --value nixpi-home.service | grep -q strict")

    nixpi.wait_until_succeeds("curl -sf http://127.0.0.1:8080 | grep -q 'NixPI Home'", timeout=60)
    nixpi.wait_until_succeeds("curl -sf http://127.0.0.1:8081/config.json | grep -q 'default_server_config'", timeout=60)

    print("NixPI modular service tests passed!")
  '';
}
