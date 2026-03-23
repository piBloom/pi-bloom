{ pkgs, nixPiModulesNoShell, piAgent, appPackage, setupPackage, mkTestFilesystems, ... }:

let
  mkNode = { hostName, username, prefill ? false }: { ... }: let
    homeDir = "/home/${username}";
  in {
    imports = nixPiModulesNoShell ++ [
      ../../core/os/modules/firstboot.nix
      mkTestFilesystems
    ];
    _module.args = { inherit piAgent appPackage setupPackage; };

    nixpi.primaryUser = username;
    nixpi.security.enforceServiceFirewall = true;

    virtualisation.diskSize = 20480;
    virtualisation.memorySize = 4096;

    boot.loader.systemd-boot.enable = true;
    boot.loader.efi.canTouchEfiVariables = true;
    networking.hostName = hostName;
    time.timeZone = "UTC";
    i18n.defaultLocale = "en_US.UTF-8";
    networking.networkmanager.enable = true;
    system.stateVersion = "25.05";

    users.users.${username} = {
      isNormalUser = true;
      group = username;
      extraGroups = [ "wheel" "networkmanager" ];
      home = homeDir;
      shell = pkgs.bash;
    };
    users.groups.${username} = { };
    system.activationScripts.nixpi-prefill = ''
      mkdir -p ${homeDir}/.nixpi
      ${if prefill then ''
        cat > ${homeDir}/.nixpi/prefill.env << 'EOF'
PREFILL_USERNAME=testuser
PREFILL_MATRIX_PASSWORD=testpassword123
EOF
        chmod 644 ${homeDir}/.nixpi/prefill.env
      '' else ''
        rm -f ${homeDir}/.nixpi/prefill.env
      ''}
      chown -R ${username}:${username} ${homeDir}/.nixpi
      chmod 755 ${homeDir}/.nixpi
    '';
  };
in
pkgs.testers.runNixOSTest {
  name = "nixpi-security";

  nodes = {
    bootstrap = mkNode {
      hostName = "nixpi-bootstrap";
      username = "pi";
      prefill = false;
    };

    steady = mkNode {
      hostName = "nixpi-steady";
      username = "pi";
      prefill = true;
    };

    client = { ... }: {
      virtualisation.diskSize = 5120;
      virtualisation.memorySize = 1024;

      boot.loader.systemd-boot.enable = true;
      boot.loader.efi.canTouchEfiVariables = true;
      networking.hostName = "client";
      time.timeZone = "UTC";
      i18n.defaultLocale = "en_US.UTF-8";
      networking.networkmanager.enable = true;
      system.stateVersion = "25.05";

      environment.systemPackages = with pkgs; [ curl netcat ];
    };
  };

  testScript = ''
    bootstrap = machines[0]
    client = machines[1]
    steady = machines[2]

    bootstrap.start()
    bootstrap.wait_for_unit("multi-user.target", timeout=300)
    bootstrap.wait_for_unit("continuwuity.service", timeout=60)
    bootstrap.wait_for_unit("fail2ban.service", timeout=60)
    bootstrap.wait_until_succeeds("test ! -f /home/pi/.nixpi/.setup-complete", timeout=30)

    steady.start()
    steady.wait_for_unit("multi-user.target", timeout=300)
    steady.succeed("su - pi -c 'setup-wizard.sh'")
    steady.wait_until_succeeds("test -f /home/pi/.nixpi/.setup-complete", timeout=120)
    steady.wait_for_unit("fail2ban.service", timeout=60)

    client.start()
    client.wait_for_unit("multi-user.target", timeout=120)
    client.wait_until_succeeds("ip -4 addr show dev eth1 | grep -q 'inet '", timeout=60)

    client.succeed("nc -z nixpi-bootstrap 22")

    client.succeed("! nc -z -w 2 nixpi-steady 22")

    steady.wait_until_succeeds("curl -sf http://127.0.0.1:6167/_matrix/client/versions", timeout=60)
    steady.wait_until_succeeds("curl -sf http://127.0.0.1 | grep -q 'NixPI Home'", timeout=60)
    steady.wait_until_succeeds("curl -sf http://127.0.0.1:8080 | grep -q 'NixPI Home'", timeout=60)

    steady.succeed("test \"$(curl -s -o /tmp/register.out -w '%{http_code}' -X POST http://127.0.0.1:6167/_matrix/client/v3/register -H 'Content-Type: application/json' -d '{\"username\":\"blocked\",\"password\":\"testpassword123\",\"inhibit_login\":false}')\" != 200")

    steady.succeed("fail2ban-client status sshd | grep -q 'Status for the jail: sshd'")

    blocked_ports = [80, 6167, 8080, 8081, 5000, 8443]
    for host in ["nixpi-bootstrap", "nixpi-steady"]:
        for port in blocked_ports:
            client.succeed(f"! nc -z -w 2 {host} {port}")

    print("NixPI security exposure policy tests passed!")
  '';
}
