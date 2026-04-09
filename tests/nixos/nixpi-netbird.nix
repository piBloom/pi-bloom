{
  mkTestFilesystems,
  nixPiModulesNoShell,
  mkManagedUserConfig,
  ...
}:

{
  name = "nixpi-netbird";

  nodes.nixpi =
    { ... }:
    {
      imports = nixPiModulesNoShell ++ [
        mkTestFilesystems
        (mkManagedUserConfig { username = "pi"; })
      ];

      networking.hostName = "nixpi-netbird-test";

      nixpi.netbird = {
        enable = true;
        setupKeyFile = "/var/lib/nixpi/bootstrap/netbird-setup-key";
        clientName = "nixpi-netbird-test";
      };

      environment.etc."nixpi-test/netbird-setup-key".text = "TEST-SETUP-KEY";
      systemd.tmpfiles.rules = [
        "d /var/lib/nixpi/bootstrap 0700 root root -"
        "C /var/lib/nixpi/bootstrap/netbird-setup-key 0600 root root - /etc/nixpi-test/netbird-setup-key"
      ];
    };

  testScript = ''
    nixpi = machines[0]

    nixpi.start()
    nixpi.wait_for_unit("multi-user.target", timeout=300)
    nixpi.wait_for_unit("systemd-resolved.service", timeout=120)

    nixpi.succeed("command -v netbird-wt0")
    nixpi.succeed("systemctl cat netbird-wt0.service >/dev/null")
    nixpi.succeed("systemctl cat netbird-wt0-login.service >/dev/null")
    nixpi.succeed("systemctl cat netbird-wt0-login.service | grep -q '/var/lib/nixpi/bootstrap/netbird-setup-key'")
    nixpi.succeed("systemctl is-enabled systemd-resolved.service | grep -qx enabled")

    print("NixPI NetBird configuration test passed!")
  '';
}
