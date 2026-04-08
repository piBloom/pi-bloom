{ nixPiModulesNoShell, mkTestFilesystems, ... }:

{
  name = "nixpi-runtime";

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
      networking.hostName = "nixpi-runtime-test";
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
    nixpi.wait_for_unit("nixpi-app-setup.service", timeout=60)

    nixpi.succeed("test -d /usr/local/share/nixpi")
    nixpi.succeed("test -d /home/pi/.pi")
    nixpi.succeed("test -d /home/pi/.pi/agent")
    nixpi.succeed("test ! -L /home/pi/.pi")
    nixpi.succeed('test "$(stat -c %U /home/pi/.pi)" = pi')
    nixpi.succeed("test -L /home/pi/.pi/settings.json")
    nixpi.succeed("readlink /home/pi/.pi/settings.json | grep -q '^/nix/store/'")
    nixpi.fail("test -e /home/pi/.pi/agent/auth.json")
    nixpi.fail("test -L /home/pi/.pi/agent/auth.json")
    nixpi.fail("systemctl cat nixpi-app-setup.service | grep -Eq 'chown -R|install -m 0600'")
    nixpi.succeed("pi --help | grep -q \"AI coding assistant\"")

    print("nixpi-runtime tests passed!")
  '';
}
