{ lib, nixPiModulesNoShell, piAgent, appPackage, setupApplyPackage, mkTestFilesystems, mkManagedUserConfig, ... }:

{
  name = "nixpi-post-setup-lockdown";

  nodes = {
    nixpi = { ... }: let
      username = "pi";
      homeDir = "/home/${username}";
    in {
      imports = nixPiModulesNoShell ++ [
        ../../core/os/modules/broker.nix
        ../../core/os/modules/firstboot
        mkTestFilesystems
      ];
      _module.args = { inherit piAgent appPackage setupApplyPackage; };

      networking.hostName = "nixpi-steady";
      nixpi.security.enforceServiceFirewall = true;

      virtualisation.diskSize = 20480;
      virtualisation.memorySize = 4096;

      boot.loader.systemd-boot.enable = true;
      boot.loader.efi.canTouchEfiVariables = true;
      networking.networkmanager.enable = true;
      time.timeZone = "UTC";
      i18n.defaultLocale = "en_US.UTF-8";
      system.stateVersion = "25.05";
      system.activationScripts.nixpi-bootstrap = lib.stringAfter [ "users" ] ''
        mkdir -p ${homeDir}/.nixpi
        install -d -m 0755 /etc/nixos
        cat > /etc/nixos/nixpi-install.nix <<'EOF'
{ ... }:
{
  networking.hostName = "nixpi-steady";
  nixpi.primaryUser = "${username}";
}
EOF
        chown -R ${username}:${username} ${homeDir}/.nixpi
        chmod 755 ${homeDir}/.nixpi
      '';
    } // (mkManagedUserConfig { inherit username homeDir; });

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
    client = machines[0]
    nixpi = machines[1]

    nixpi.start()
    nixpi.wait_for_unit("multi-user.target", timeout=300)
    nixpi.wait_until_succeeds("curl -sf http://127.0.0.1:8080/ | grep -q 'nixpi-shell'", timeout=60)
    nixpi.succeed("env NIXPI_PRIMARY_USER=pi nixpi-setup-apply | tee /tmp/setup-apply.out")
    nixpi.wait_until_succeeds("test -f /home/pi/.nixpi/wizard-state/system-ready", timeout=180)
    nixpi.fail("test -f /home/pi/.nixpi/.setup-complete")
    nixpi.wait_until_succeeds("nc -z 127.0.0.1 8080", timeout=60)

    client.start()
    client.wait_for_unit("multi-user.target", timeout=120)
    client.wait_until_succeeds("ip -4 addr show dev eth1 | grep -q 'inet '", timeout=60)

    # SSH remains available; only app/bootstrap surfaces are locked down.
    client.succeed("nc -z -w 2 nixpi-steady 22")

    # Local services remain available on loopback.
    nixpi.succeed("nc -z 127.0.0.1 8080")

    # Bootstrap wrappers refuse to run after setup.
    nixpi.fail("su - pi -c 'sudo -n /run/current-system/sw/bin/nixpi-bootstrap-brokerctl status >/tmp/broker.out 2>/tmp/broker.err'")
    nixpi.succeed("grep -Eq 'bootstrap access is disabled after setup completes|a password is required' /tmp/broker.err")

    # App ports are still blocked from an untrusted peer.
    for port in [8080]:
        client.succeed(f"! nc -z -w 2 nixpi-steady {port}")

    print("NixPI post-setup lockdown test passed!")
  '';
}
