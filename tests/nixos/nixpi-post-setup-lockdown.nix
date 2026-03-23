{ lib, nixPiModulesNoShell, piAgent, appPackage, setupPackage, mkTestFilesystems, mkManagedUserConfig, mkPrefillActivation, ... }:

{
  name = "nixpi-post-setup-lockdown";

  nodes = {
    nixpi = { ... }: let
      username = "pi";
      homeDir = "/home/${username}";
    in {
      imports = nixPiModulesNoShell ++ [
        ../../core/os/modules/broker.nix
        ../../core/os/modules/firstboot.nix
        mkTestFilesystems
      ];
      _module.args = { inherit piAgent appPackage setupPackage; };

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
      system.activationScripts.nixpi-prefill = mkPrefillActivation {
        inherit username homeDir;
        matrixUsername = "steadyuser";
        matrixPassword = "steadypass123";
      } + ''
        chown -R ${username}:${username} ${homeDir}/.nixpi
      '';
    } // (mkManagedUserConfig { inherit username homeDir; });

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
    client = machines[0]
    nixpi = machines[1]

    nixpi.start()
    nixpi.wait_for_unit("multi-user.target", timeout=300)
    nixpi.succeed("su - pi -c 'setup-wizard.sh'")
    nixpi.wait_until_succeeds("test -f /home/pi/.nixpi/wizard-state/system-ready", timeout=180)
    nixpi.fail("test -f /home/pi/.nixpi/.setup-complete")
    nixpi.wait_until_succeeds("curl -sf http://127.0.0.1:6167/_matrix/client/versions", timeout=60)
    nixpi.wait_until_succeeds("curl -sf http://127.0.0.1:8080 | grep -q 'NixPI Home'", timeout=60)

    client.start()
    client.wait_for_unit("multi-user.target", timeout=120)
    client.wait_until_succeeds("ip -4 addr show dev eth1 | grep -q 'inet '", timeout=60)

    # SSH is disabled after setup by default.
    client.succeed("! nc -z -w 2 nixpi-steady 22")
    nixpi.succeed("systemctl show -p ActiveState --value sshd.service | grep -Eq 'inactive|failed'")

    # Registration is disabled once setup completes.
    nixpi.succeed("""
      test "$(
        curl -s -o /tmp/post-setup-register.out -w '%{http_code}' -X POST http://127.0.0.1:6167/_matrix/client/v3/register \
        -H 'Content-Type: application/json' \
        -d '{"username":"blocked","password":"blockedpass123","inhibit_login":false}' \
      )" != 200
    """)

    # Local services remain available on loopback.
    nixpi.succeed("curl -sf http://127.0.0.1:8080 | grep -q 'NixPI Home'")
    nixpi.succeed("curl -sf http://127.0.0.1:8081/config.json | grep -q 'default_server_config'")

    # Bootstrap wrappers refuse to run after setup.
    nixpi.fail("su - pi -c 'sudo -n /run/current-system/sw/bin/nixpi-bootstrap-read-matrix-secret >/tmp/secret.out 2>/tmp/secret.err'")
    nixpi.succeed("grep -q 'bootstrap access is disabled after setup completes' /tmp/secret.err")
    nixpi.fail("su - pi -c 'sudo -n /run/current-system/sw/bin/nixpi-bootstrap-brokerctl status >/tmp/broker.out 2>/tmp/broker.err'")
    nixpi.succeed("grep -q 'bootstrap access is disabled after setup completes' /tmp/broker.err")

    # App ports are still blocked from an untrusted peer.
    for port in [6167, 8080, 8081]:
        client.succeed(f"! nc -z -w 2 nixpi-steady {port}")

    print("NixPI post-setup lockdown test passed!")
  '';
}
