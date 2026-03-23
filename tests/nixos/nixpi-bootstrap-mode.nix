{ pkgs, lib, nixPiModulesNoShell, piAgent, appPackage, setupPackage, mkTestFilesystems, mkManagedUserConfig, ... }:

pkgs.testers.runNixOSTest {
  name = "nixpi-bootstrap-mode";

  nodes = {
    bootstrap = { ... }: let
      username = "pi";
    in {
      imports = nixPiModulesNoShell ++ [
        ../../core/os/modules/broker.nix
        ../../core/os/modules/firstboot.nix
        mkTestFilesystems
      ];
      _module.args = { inherit piAgent appPackage setupPackage; };
      networking.hostName = "nixpi-bootstrap";

      nixpi.security.enforceServiceFirewall = true;
      virtualisation.diskSize = 20480;
      virtualisation.memorySize = 4096;

      boot.loader.systemd-boot.enable = true;
      boot.loader.efi.canTouchEfiVariables = true;
      networking.networkmanager.enable = true;
      time.timeZone = "UTC";
      i18n.defaultLocale = "en_US.UTF-8";
      system.stateVersion = "25.05";

      # Bootstrap without prefill keeps the machine in setup mode.
    } // (mkManagedUserConfig { inherit username; });

    client = { ... }: {
      imports = [ mkTestFilesystems ];

      virtualisation.diskSize = 5120;
      virtualisation.memorySize = 1024;
      virtualisation.graphics = false;

      boot.loader.systemd-boot.enable = true;
      boot.loader.efi.canTouchEfiVariables = true;
      networking.hostName = "client";
      networking.networkmanager.enable = true;
      time.timeZone = "UTC";
      i18n.defaultLocale = "en_US.UTF-8";
      system.stateVersion = "25.05";

      environment.systemPackages = with pkgs; [ curl netcat ];
    };
  };

  testScript = ''
    bootstrap = machines[0]
    client = machines[1]

    bootstrap.start()
    bootstrap.wait_for_unit("multi-user.target", timeout=300)
    bootstrap.wait_for_unit("continuwuity.service", timeout=120)
    bootstrap.succeed("command -v setup-wizard.sh")
    bootstrap.wait_until_succeeds("test ! -f /home/pi/.nixpi/.setup-complete", timeout=60)

    client.start()
    client.wait_for_unit("multi-user.target", timeout=120)
    client.wait_until_succeeds("ip -4 addr show dev eth1 | grep -q 'inet '", timeout=60)

    # SSH remains available during bootstrap.
    bootstrap.wait_for_unit("sshd.service", timeout=60)
    client.succeed("nc -z nixpi-bootstrap 22")

    # Registration stays enabled before setup completes.
    bootstrap.succeed("""
      curl -s -X POST http://127.0.0.1:6167/_matrix/client/v3/register \
        -H 'Content-Type: application/json' \
        -d '{"username":"bootstrapuser","password":"bootstrappass123","inhibit_login":false}' \
        | grep -Eq '"access_token"|"session"'
    """)

    # Bootstrap-only helper commands remain usable.
    bootstrap.succeed("su - pi -c 'sudo -n /run/current-system/sw/bin/nixpi-bootstrap-read-matrix-secret | grep -Eq \"^[0-9a-f]+$\"'")
    bootstrap.succeed("su - pi -c 'sudo -n /run/current-system/sw/bin/nixpi-bootstrap-brokerctl status | grep -q effectiveAutonomy'")
    bootstrap.succeed("grep -q 'nixpi-bootstrap-sshd-systemctl stop sshd.service' /etc/sudoers")

    # Service ports remain local-only until the trusted interface exists.
    for port in [6167, 8080, 8081, 5000, 8443]:
        client.succeed(f"! nc -z -w 2 nixpi-bootstrap {port}")

    print("NixPI bootstrap mode test passed!")
  '';
}
