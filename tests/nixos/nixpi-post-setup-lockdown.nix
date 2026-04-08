{
  lib,
  nixPiModulesNoShell,
  mkTestFilesystems,
  mkManagedUserConfig,
  ...
}:

{
  name = "nixpi-post-setup-lockdown";

  nodes = {
    nixpi =
      _:
      let
        username = "pi";
        homeDir = "/home/${username}";
      in
      {
        imports = nixPiModulesNoShell ++ [
          ../../core/os/modules/broker.nix
          mkTestFilesystems
        ];

        networking.hostName = "nixpi-steady";
        nixpi.security.enforceServiceFirewall = true;
        system.activationScripts.nixpi-bootstrap = lib.stringAfter [ "users" ] ''
          mkdir -p ${homeDir}/.nixpi
          chown -R ${username}:${username} ${homeDir}/.nixpi
          chmod 755 ${homeDir}/.nixpi
        '';
      }
      // (mkManagedUserConfig { inherit username homeDir; });

    client =
      { pkgs, ... }:
      {
        imports = [ mkTestFilesystems ];

        virtualisation = {
          diskSize = 5120;
          memorySize = 1024;
          graphics = false;
        };

        networking.hostName = "client";

        environment.systemPackages = with pkgs; [
          curl
          netcat
        ];
      };
  };

  testScript = ''
    client = machines[0]
    nixpi = machines[1]

    nixpi.start()
    nixpi.wait_for_unit("multi-user.target", timeout=300)
    nixpi.wait_for_unit("nixpi-app-setup.service", timeout=120)
    nixpi.succeed("env NIXPI_PRIMARY_USER=pi nixpi-setup-apply | tee /tmp/setup-apply.out")
    nixpi.wait_until_succeeds("test -f /home/pi/.nixpi/wizard-state/system-ready", timeout=180)
    nixpi.fail("test -f /home/pi/.nixpi/.setup-complete")
    nixpi.fail("su - pi -c 'sudo -n true'")
    nixpi.succeed("su - pi -c 'nixpi-brokerctl status >/tmp/broker-status.json'")
    nixpi.succeed("test -f /home/pi/.pi/settings.json")
    nixpi.succeed("command -v pi")

    client.start()
    client.wait_for_unit("multi-user.target", timeout=120)
    client.wait_until_succeeds("ip -4 addr show dev eth1 | grep -q 'inet '", timeout=60)

    # SSH remains available; only app/bootstrap surfaces are locked down.
    client.succeed("nc -z -w 2 nixpi-steady 22")

    print("NixPI post-setup lockdown test passed!")
  '';
}
