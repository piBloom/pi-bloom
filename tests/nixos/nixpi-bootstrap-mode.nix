{ lib, nixPiModulesNoShell, piAgent, appPackage, mkTestFilesystems, mkManagedUserConfig, ... }:

{
  name = "nixpi-bootstrap-mode";

  nodes = {
    bootstrap = { ... }: let
      username = "pi";
    in {
      imports = nixPiModulesNoShell ++ [
        ../../core/os/modules/broker.nix
        ../../core/os/modules/firstboot
        mkTestFilesystems
      ];
      _module.args = { inherit piAgent appPackage; };
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

    client = { pkgs, ... }: {
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
    bootstrap.succeed("command -v nixpi-bootstrap")
    bootstrap.wait_until_succeeds("test ! -f /home/pi/.nixpi/wizard-state/system-ready", timeout=60)

    client.start()
    client.wait_for_unit("multi-user.target", timeout=120)
    client.wait_until_succeeds("ip -4 addr show dev eth1 | grep -q 'inet '", timeout=60)

    # SSH remains available during bootstrap.
    bootstrap.wait_for_unit("sshd.service", timeout=60)
    client.succeed("nc -z nixpi-bootstrap 22")

    # nixpi-bootstrap dispatcher subcommands are available and guarded.
    # brokerctl delegation works during bootstrap.
    bootstrap.succeed(
        "su - pi -c 'sudo -n /run/current-system/sw/bin/nixpi-bootstrap brokerctl status"
        " | grep -q effectiveAutonomy'"
    )
    # The sshd-systemctl subcommand is in sudoers (new dispatcher format).
    bootstrap.succeed(
        "grep -q 'nixpi-bootstrap sshd-systemctl stop sshd.service' /etc/sudoers"
    )
    # Unknown subcommands fail.
    bootstrap.fail(
        "nixpi-bootstrap unknown-subcommand 2>/dev/null"
    )
    # Password file subcommands are in sudoers.
    bootstrap.succeed(
        "grep -q 'nixpi-bootstrap read-primary-password' /etc/sudoers"
    )
    # After system-ready is set, all subcommands are blocked.
    bootstrap.succeed("mkdir -p /home/pi/.nixpi/wizard-state")
    bootstrap.succeed("touch /home/pi/.nixpi/wizard-state/system-ready")
    bootstrap.fail("nixpi-bootstrap brokerctl status 2>/dev/null")
    bootstrap.fail("nixpi-bootstrap write-host-nix h u UTC us 2>/dev/null")
    bootstrap.succeed("rm /home/pi/.nixpi/wizard-state/system-ready")

    # Service ports remain local-only until the trusted interface exists.
    for port in [8080, 8081, 5000, 8443]:
        client.succeed(f"! nc -z -w 2 nixpi-bootstrap {port}")

    print("NixPI bootstrap mode test passed!")
  '';
}
