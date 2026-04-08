{ mkTestFilesystems, ... }:

let
  mkNode =
    {
      hostName,
      username,
      bootstrapEnable ? true,
      sshEnable ? bootstrapEnable,
      temporaryAdminEnable ? bootstrapEnable,
    }:
    {
      ...
    }:
    let
      homeDir = "/home/${username}";
    in
    {
      imports = [
        ../../core/os/hosts/vps.nix
        mkTestFilesystems
      ];

      nixpi = {
        primaryUser = username;
        security.enforceServiceFirewall = true;
        bootstrap.enable = bootstrapEnable;
        bootstrap.ssh.enable = sshEnable;
        bootstrap.temporaryAdmin.enable = temporaryAdminEnable;
      };

      networking.hostName = hostName;
      systemd.tmpfiles.rules = [ "d ${homeDir}/.nixpi 0755 ${username} ${username} -" ];
    };
in
{
  name = "nixpi-security";

  nodes = {
    bootstrap = mkNode {
      hostName = "nixpi-bootstrap";
      username = "pi";
      bootstrapEnable = true;
    };

    steady = mkNode {
      hostName = "nixpi-steady";
      username = "pi";
      bootstrapEnable = false;
      sshEnable = true;
      temporaryAdminEnable = false;
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
    bootstrap.wait_for_unit("sshd.service", timeout=60)
    bootstrap.succeed("sudo -u pi -- sudo -n true")
    bootstrap.succeed("test -f /home/pi/.pi/settings.json")

    steady.start()
    steady.wait_for_unit("multi-user.target", timeout=300)
    steady.wait_for_unit("nixpi-app-setup.service", timeout=120)
    steady.wait_for_unit("sshd.service", timeout=60)
    steady.fail("sudo -u pi -- sudo -n true")
    steady.succeed("sudo -u pi -- bash -lc 'nixpi-brokerctl status >/tmp/steady-broker-status.json'")
    steady.wait_for_unit("fail2ban.service", timeout=60)
    steady.succeed("test -f /home/pi/.pi/settings.json")
    steady.succeed("command -v pi")
    steady.fail("command -v nixpi-setup-apply")

    client.start()
    client.wait_for_unit("multi-user.target", timeout=120)
    client.wait_until_succeeds("ip -4 addr show dev eth1 | grep -q 'inet '", timeout=60)

    client.succeed("nc -z nixpi-bootstrap 22")
    client.succeed("nc -z -w 2 nixpi-steady 22")

    steady.succeed("fail2ban-client status sshd | grep -q 'Status for the jail: sshd'")

    print("NixPI security exposure policy tests passed!")
  '';
}
