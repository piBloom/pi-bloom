{
  nixPiModulesNoShell,
  mkTestFilesystems,
  mkManagedUserConfig,
  ...
}:

{
  name = "nixpi-options-validation";

  nodes = {
    defaults = { config, ... }: {
      imports = nixPiModulesNoShell ++ [
        mkTestFilesystems
        (mkManagedUserConfig { username = "pi"; })
      ];

      networking.hostName = "nixpi-defaults-test";

      environment.etc."nixpi-tests/ssh-password-auth".text =
        if config.services.openssh.settings.PasswordAuthentication then "yes" else "no";
    };

    overrides = { config, ... }: {
      imports = nixPiModulesNoShell ++ [
        mkTestFilesystems
        (mkManagedUserConfig { username = "pi"; })
      ];

      networking.hostName = "nixpi-overrides-test";

      nixpi = {
        agent.autonomy = "observe";
        security = {
          fail2ban.enable = false;
          ssh.passwordAuthentication = true;
        };
      };

      environment.etc."nixpi-tests/ssh-password-auth".text =
        if config.services.openssh.settings.PasswordAuthentication then "yes" else "no";
    };
  };

  testScript = ''
    defaults = machines[0]
    overrides = machines[1]

    defaults.start()
    defaults.wait_for_unit("multi-user.target", timeout=300)

    defaults.succeed("id pi")
    defaults.succeed("systemctl cat nixpi-broker.service >/dev/null")
    defaults.succeed("systemctl cat nixpi-update.timer >/dev/null")

    broker_cfg = defaults.succeed(
        "systemctl show nixpi-broker.service -p Environment --value"
        " | grep -oP 'NIXPI_BROKER_CONFIG=\\K\\S+'"
    ).strip()
    defaults.succeed(f"grep -q maintain {broker_cfg}")

    defaults.succeed("systemctl is-active fail2ban")
    defaults.succeed("grep -qx 'no' /etc/nixpi-tests/ssh-password-auth")

    overrides.start()
    overrides.wait_for_unit("multi-user.target", timeout=300)

    overrides.fail("systemctl is-active fail2ban")
    overrides.succeed("grep -qx 'yes' /etc/nixpi-tests/ssh-password-auth")
    broker_cfg = overrides.succeed(
        "systemctl show nixpi-broker.service -p Environment --value"
        " | grep -oP 'NIXPI_BROKER_CONFIG=\\K\\S+'"
    ).strip()
    overrides.succeed(f"grep -q observe {broker_cfg}")

    print("All nixpi-options-validation tests passed!")
  '';
}
