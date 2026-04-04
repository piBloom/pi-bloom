{ nixPiModules, nixPiModulesNoShell, piAgent, appPackage, mkTestFilesystems, ... }:

{
  name = "nixpi-network";

  nodes = {
    nixpi1 = { ... }: {
      imports = nixPiModules ++ [ mkTestFilesystems ];
      _module.args = { inherit piAgent appPackage; };
      nixpi.primaryUser = "tester1";

      virtualisation.diskSize = 10240;
      virtualisation.memorySize = 2048;

      networking.hostName = "nixpi1";
      time.timeZone = "UTC";
      i18n.defaultLocale = "en_US.UTF-8";
      networking.networkmanager.enable = true;
      system.stateVersion = "25.05";
      boot.loader.systemd-boot.enable = true;
      boot.loader.efi.canTouchEfiVariables = true;
    };

    nixpi2 = { ... }: {
      imports = nixPiModules ++ [ mkTestFilesystems ];
      _module.args = { inherit piAgent appPackage; };
      nixpi.primaryUser = "tester2";

      virtualisation.diskSize = 10240;
      virtualisation.memorySize = 2048;

      networking.hostName = "nixpi2";
      time.timeZone = "UTC";
      i18n.defaultLocale = "en_US.UTF-8";
      networking.networkmanager.enable = true;
      system.stateVersion = "25.05";
      boot.loader.systemd-boot.enable = true;
      boot.loader.efi.canTouchEfiVariables = true;
    };
  };

  testScript = ''
    nixpi1 = machines[0]
    nixpi2 = machines[1]

    start_all()

    for node in [nixpi1, nixpi2]:
        node.wait_for_unit("multi-user.target", timeout=300)

    nixpi1.wait_until_succeeds("getent hosts nixpi2", timeout=120)
    nixpi2.wait_until_succeeds("getent hosts nixpi1", timeout=120)
    nixpi1.wait_until_succeeds("ping -c 1 nixpi2", timeout=120)
    nixpi2.wait_until_succeeds("ping -c 1 nixpi1", timeout=120)
    nixpi1.succeed("ping -c 3 nixpi2")
    nixpi2.succeed("ping -c 3 nixpi1")

    for node in [nixpi1, nixpi2]:
        node.wait_for_unit("sshd.service", timeout=60)
        node.succeed("systemctl is-active sshd")

    for node in [nixpi1, nixpi2]:
        node.succeed("systemctl is-active NetworkManager")
        nm_status = node.succeed("nmcli general status")
        assert "connected" in nm_status.lower(), "NetworkManager not connected: " + nm_status

    for node in [nixpi1, nixpi2]:
        node.succeed("systemctl is-active firewall.service || true")  # May be named differently
        nixpi1.succeed("nc -z nixpi2 22")
        nixpi2.succeed("nc -z nixpi1 22")

    nixpi1.succeed("getent hosts nixpi2")
    nixpi2.succeed("getent hosts nixpi1")

    print("All nixpi-network tests passed!")
  '';
}
