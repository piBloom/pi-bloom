{ nixPiModulesNoShell, piAgent, appPackage, mkTestFilesystems, ... }:

{
  name = "nixpi-chat";

  nodes.nixpi = { pkgs, ... }: let
    username = "pi";
    homeDir = "/home/${username}";
  in {
    imports = nixPiModulesNoShell ++ [ mkTestFilesystems ];
    _module.args = { inherit piAgent appPackage; };
    nixpi.primaryUser = username;

    virtualisation.diskSize = 10240;
    virtualisation.memorySize = 2048;
    networking.hostName = "nixpi-chat-test";
    time.timeZone = "UTC";
    i18n.defaultLocale = "en_US.UTF-8";
    networking.networkmanager.enable = true;
    system.stateVersion = "25.05";
    boot.loader.systemd-boot.enable = true;
    boot.loader.efi.canTouchEfiVariables = true;
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

    # Chat service should exist and be running.
    nixpi.wait_for_unit("nixpi-chat.service", timeout=60)
    nixpi.succeed("test -f /etc/systemd/system/nixpi-chat.service")
    nixpi.succeed("test -d /usr/local/share/nixpi")
    nixpi.succeed("test -f /usr/local/share/nixpi/dist/core/chat-server/index.js")
    nixpi.succeed("test -f /usr/local/share/nixpi/core/chat-server/frontend/dist/index.html")

    exec_start = nixpi.succeed("systemctl show -p ExecStart --value nixpi-chat.service")
    assert "node" in exec_start and "chat-server/index.js" in exec_start, \
        "Unexpected ExecStart: " + exec_start

    nixpi.wait_until_succeeds("curl -sf http://127.0.0.1:8080/ | grep -qi '<html'", timeout=60)

    result = nixpi.succeed(
        "curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:8080/chat "
        + "-H 'Content-Type: application/json' -d '{\"message\":\"hello\"}'"
    ).strip()
    assert result == "400", "Expected 400 for missing sessionId, got: " + result

    result = nixpi.succeed(
        "curl -s -o /dev/null -w '%{http_code}' -X DELETE http://127.0.0.1:8080/chat/test-id"
    ).strip()
    assert result == "204", "Expected 204 for DELETE, got: " + result

    nixpi.wait_until_succeeds("curl -sf http://127.0.0.1/ | grep -qi '<html'", timeout=60)

    print("nixpi-chat tests passed!")
  '';
}
