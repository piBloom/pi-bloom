{ nixPiModulesNoShell, mkTestFilesystems, ... }:

let
  mkNode =
    { hostName, username }:
    { pkgs, ... }:
    let
      homeDir = "/home/${username}";
    in
    {
      imports = nixPiModulesNoShell ++ [
        mkTestFilesystems
      ];

      nixpi.primaryUser = username;
      nixpi.security.enforceServiceFirewall = true;

      virtualisation.diskSize = 20480;
      virtualisation.memorySize = 4096;

      boot.loader.systemd-boot.enable = true;
      boot.loader.efi.canTouchEfiVariables = true;
      networking.hostName = hostName;
      time.timeZone = "UTC";
      i18n.defaultLocale = "en_US.UTF-8";
      networking.networkmanager.enable = true;
      system.stateVersion = "25.05";

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
      system.activationScripts.nixpi-bootstrap = ''
        mkdir -p ${homeDir}/.nixpi
        chown -R ${username}:${username} ${homeDir}/.nixpi
        chmod 755 ${homeDir}/.nixpi
      '';
    };
in
{
  name = "nixpi-security";

  nodes = {
    bootstrap = mkNode {
      hostName = "nixpi-bootstrap";
      username = "pi";
    };

    steady = mkNode {
      hostName = "nixpi-steady";
      username = "pi";
    };

    client =
      { pkgs, ... }:
      {
        virtualisation.diskSize = 5120;
        virtualisation.memorySize = 1024;

        boot.loader.systemd-boot.enable = true;
        boot.loader.efi.canTouchEfiVariables = true;
        networking.hostName = "client";
        time.timeZone = "UTC";
        i18n.defaultLocale = "en_US.UTF-8";
        networking.networkmanager.enable = true;
        system.stateVersion = "25.05";

        environment.systemPackages = with pkgs; [
          curl
          netcat
        ];
      };
  };

  testScript = ''
    bootstrap = machines[0]
    client = machines[1]
    steady = machines[2]

    bootstrap.start()
    bootstrap.wait_for_unit("multi-user.target", timeout=300)
    bootstrap.wait_for_unit("fail2ban.service", timeout=60)
    bootstrap.wait_for_unit("nixpi-app-setup.service", timeout=120)
    bootstrap.wait_until_succeeds("test ! -f /home/pi/.nixpi/wizard-state/system-ready", timeout=30)
    bootstrap.succeed("su - pi -c 'sudo -n true'")
    bootstrap.succeed("test -f /home/pi/.pi/settings.json")

    steady.start()
    steady.wait_for_unit("multi-user.target", timeout=300)
    steady.wait_for_unit("nixpi-app-setup.service", timeout=120)
    steady.succeed("env NIXPI_PRIMARY_USER=pi nixpi-setup-apply | tee /tmp/setup-apply.out")
    steady.wait_until_succeeds("test -f /home/pi/.nixpi/wizard-state/system-ready", timeout=120)
    steady.fail("su - pi -c 'sudo -n true'")
    steady.succeed("su - pi -c 'nixpi-brokerctl status >/tmp/steady-broker-status.json'")
    steady.wait_for_unit("fail2ban.service", timeout=60)
    steady.succeed("test -f /home/pi/.pi/settings.json")
    steady.succeed("command -v pi")

    client.start()
    client.wait_for_unit("multi-user.target", timeout=120)
    client.wait_until_succeeds("ip -4 addr show dev eth1 | grep -q 'inet '", timeout=60)

    client.succeed("nc -z nixpi-bootstrap 22")

    client.succeed("nc -z -w 2 nixpi-steady 22")

    steady.succeed("fail2ban-client status sshd | grep -q 'Status for the jail: sshd'")

    print("NixPI security exposure policy tests passed!")
  '';
}
