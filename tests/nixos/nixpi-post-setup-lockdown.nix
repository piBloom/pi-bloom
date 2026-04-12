{ mkTestFilesystems, ... }:

let
  username = "pi";
  homeDir = "/home/${username}";
in
{
  name = "nixpi-post-setup-lockdown";

  nodes = {
    nixpi = {
      ...
    }: {
      imports = [
        ../../core/os/hosts/vps.nix
        mkTestFilesystems
      ];

      networking.hostName = "nixpi-steady";
      nixpi = {
        primaryUser = username;
        bootstrap.enable = false;
        bootstrap.ssh.enable = true;
        bootstrap.temporaryAdmin.enable = false;
        security.enforceServiceFirewall = true;
        security.ssh.allowedSourceCIDRs = [ "192.0.2.10/32" ];
      };

      systemd.tmpfiles.rules = [ "d ${homeDir}/.nixpi 0755 ${username} ${username} -" ];
    };

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
    nixpi.wait_for_unit("sshd.service", timeout=60)
    nixpi.fail("sudo -u pi -- sudo -n true")
    nixpi.succeed("sudo -u pi -- bash -lc 'nixpi-brokerctl status >/tmp/broker-status.json'")
    nixpi.succeed("test -f /home/pi/.pi/settings.json")
    nixpi.succeed("command -v pi")

    client.start()
    client.wait_for_unit("multi-user.target", timeout=120)
    client.wait_until_succeeds("ip -4 addr show dev eth1 | grep -q 'inet '", timeout=60)

    # Steady-state keeps SSH available while bootstrap-only privilege grants stay disabled.
    client.succeed("nc -z -w 2 nixpi-steady 22")

    print("NixPI post-setup lockdown test passed!")
  '';
}
