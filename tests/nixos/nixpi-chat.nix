{ nixPiModulesNoShell, mkTestFilesystems, ... }:

{
  name = "nixpi-terminal";

  nodes.nixpi =
    { pkgs, ... }:
    let
      username = "pi";
      homeDir = "/home/${username}";
    in
    {
      imports = nixPiModulesNoShell ++ [ mkTestFilesystems ];
      nixpi.primaryUser = username;

      virtualisation.diskSize = 10240;
      virtualisation.memorySize = 2048;
      networking.hostName = "nixpi-terminal-test";
      time.timeZone = "UTC";
      i18n.defaultLocale = "en_US.UTF-8";
      networking.networkmanager.enable = true;
      system.stateVersion = "25.05";
      boot.loader.systemd-boot.enable = true;
      boot.loader.efi.canTouchEfiVariables = true;
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

    nixpi.wait_for_unit("nixpi-ttyd.service", timeout=60)
    nixpi.succeed("test -f /etc/systemd/system/nixpi-ttyd.service")
    nixpi.succeed("test -d /usr/local/share/nixpi")

    exec_start = nixpi.succeed("systemctl show -p ExecStart --value nixpi-ttyd.service")
    assert "ttyd" in exec_start and "nixpi-terminal-bootstrap" in exec_start, \
        "Unexpected ExecStart: " + exec_start

    nixpi.wait_until_succeeds("curl -sf http://127.0.0.1/ >/dev/null", timeout=60)
    nixpi.wait_until_succeeds("curl -sf http://127.0.0.1/terminal/ >/dev/null", timeout=60)

    print("nixpi-terminal tests passed!")
  '';
}
