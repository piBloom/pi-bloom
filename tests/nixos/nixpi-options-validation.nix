{ nixPiModulesNoShell, mkTestFilesystems, mkManagedUserConfig, piAgent, appPackage, ... }:

{
  name = "nixpi-options-validation";

  nodes = {
    defaults = { ... }: {
      imports = nixPiModulesNoShell ++ [
        mkTestFilesystems
        (mkManagedUserConfig { username = "pi"; })
      ];
      _module.args = { inherit piAgent appPackage; };

      networking.hostName = "nixpi-defaults-test";

      virtualisation.diskSize = 20480;
      virtualisation.memorySize = 4096;

      boot.loader.systemd-boot.enable = true;
      boot.loader.efi.canTouchEfiVariables = true;
      networking.networkmanager.enable = true;
      time.timeZone = "UTC";
      i18n.defaultLocale = "en_US.UTF-8";
      system.stateVersion = "25.05";
    };

    overrides = { ... }: {
      imports = nixPiModulesNoShell ++ [
        mkTestFilesystems
        (mkManagedUserConfig { username = "pi"; })
      ];
      _module.args = { inherit piAgent appPackage; };

      networking.hostName = "nixpi-overrides-test";

      virtualisation.diskSize = 20480;
      virtualisation.memorySize = 4096;

      boot.loader.systemd-boot.enable = true;
      boot.loader.efi.canTouchEfiVariables = true;
      networking.networkmanager.enable = true;
      time.timeZone = "UTC";
      i18n.defaultLocale = "en_US.UTF-8";
      system.stateVersion = "25.05";

      nixpi.services.home.port = 9090;
      nixpi.security.fail2ban.enable = false;
      nixpi.security.ssh.passwordAuthentication = true;
    };
  };

  testScript = ''
    defaults = machines[0]
    overrides = machines[1]

    defaults.start()
    defaults.wait_for_unit("multi-user.target", timeout=300)

    defaults.succeed("id pi")

    defaults.wait_until_succeeds("curl -skf https://localhost/ | grep -q 'NixPI'", timeout=60)

    broker_cfg = defaults.succeed(
        "systemctl show nixpi-broker.service -p Environment --value"
        " | grep -oP 'NIXPI_BROKER_CONFIG=\\K\\S+'"
    ).strip()
    defaults.succeed(f"grep -q maintain {broker_cfg}")

    defaults.succeed("systemctl is-active fail2ban")
    defaults.succeed("sshd -T | grep -i 'passwordauthentication no'")

    overrides.start()
    overrides.wait_for_unit("multi-user.target", timeout=300)

    overrides.fail("systemctl is-active fail2ban")
    overrides.succeed("sshd -T | grep -i 'passwordauthentication yes'")

    print("All nixpi-options-validation tests passed!")
  '';
}
