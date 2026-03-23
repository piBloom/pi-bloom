{ lib, nixPiModulesNoShell, piAgent, appPackage, setupPackage, mkTestFilesystems, ... }:

{
  name = "nixpi-e2e";

  nodes = {
    nixpi = { ... }: let
      username = "pi";
      homeDir = "/home/${username}";
    in {
      imports = nixPiModulesNoShell ++ [ 
        ../../core/os/modules/firstboot.nix
        mkTestFilesystems 
      ];
      _module.args = { inherit piAgent appPackage setupPackage; };
      nixpi.primaryUser = username;

      virtualisation.diskSize = 20480;
      virtualisation.memorySize = 4096;

      networking.hostName = "pi";
      time.timeZone = "UTC";
      i18n.defaultLocale = "en_US.UTF-8";
      networking.networkmanager.enable = true;
      system.stateVersion = "25.05";
      boot.loader.systemd-boot.enable = true;
      boot.loader.efi.canTouchEfiVariables = true;

      users.users.${username} = {
        isNormalUser = true;
        group = username;
        extraGroups = [ "wheel" "networkmanager" ];
        home = homeDir;
        shell = pkgs.bash;
      };
      users.groups.${username} = {};
      system.activationScripts.nixpi-e2e-prefill = lib.stringAfter [ "users" ] ''
      mkdir -p ${homeDir}/.nixpi
      cat > ${homeDir}/.nixpi/prefill.env << 'EOF'
    PREFILL_USERNAME=e2etest
    PREFILL_MATRIX_PASSWORD=e2etestpass123
    EOF
        chown -R ${username}:${username} ${homeDir}/.nixpi
        chmod 755 ${homeDir}/.nixpi
        chmod 644 ${homeDir}/.nixpi/prefill.env
      '';
    };

    client = { ... }: {
      virtualisation.diskSize = 5120;
      virtualisation.memorySize = 1024;

      networking.hostName = "client";
      time.timeZone = "UTC";
      i18n.defaultLocale = "en_US.UTF-8";
      networking.networkmanager.enable = true;
      system.stateVersion = "25.05";
      boot.loader.systemd-boot.enable = true;
      boot.loader.efi.canTouchEfiVariables = true;

      environment.systemPackages = with pkgs; [
        curl
        netcat
        openssh
        jq
      ];
    };
  };

  testScript = ''
    client = machines[0]
    nixpi = machines[1]
    username = "pi"
    home = "/home/pi"
    matrix_user = "e2etest"
    matrix_password = "e2etestpass123"
    
    nixpi.start()
    nixpi.wait_for_unit("multi-user.target", timeout=300)
    nixpi.wait_until_succeeds("ip -4 addr show dev eth1 | grep -q 'inet '", timeout=60)
    
    client.start()
    client.wait_until_succeeds("ip -4 addr show dev eth1 | grep -q 'inet '", timeout=60)
    
    client.succeed("ping -c 3 pi")

    nixpi.succeed("su - pi -c 'setup-wizard.sh'")
    nixpi.wait_until_succeeds("test -f " + home + "/.nixpi/wizard-state/system-ready", timeout=180)
    nixpi.fail("test -f " + home + "/.nixpi/.setup-complete")

    nixpi.wait_for_unit("continuwuity.service", timeout=60)
    nixpi.succeed("curl -sf http://127.0.0.1:6167/_matrix/client/versions")

    wizard_log = nixpi.succeed("cat " + home + "/.nixpi/wizard.log")
    assert "setup complete" in wizard_log.lower(), "Wizard log missing setup completion marker"

    register_status = nixpi.succeed("""
      curl -s -o /tmp/e2e-register.out -w '%{http_code}' -X POST http://127.0.0.1:6167/_matrix/client/v3/register \
        -H "Content-Type: application/json" \
        -d '{"username":"blocked","password":"blockedpass123","inhibit_login":false}'
    """).strip()
    assert register_status != "200", "Expected registration to be disabled, got HTTP " + register_status

    client.succeed("! nc -z -w 2 pi 22")
    nixpi.succeed("systemctl show -p ActiveState --value sshd.service | grep -Eq 'inactive|failed'")

    services = ["continuwuity", "netbird", "NetworkManager"]
    for svc in services:
        nixpi.succeed("systemctl is-active " + svc + ".service")
    
    nixpi.succeed("test -d " + home + "/nixpi")
    nixpi.succeed("test -d " + home + "/.nixpi")
    nixpi.succeed("test -d " + home + "/.pi")
    nixpi.succeed("test ! -L " + home + "/.pi")
    nixpi.succeed("test -d /usr/local/share/nixpi")
    
    groups = nixpi.succeed("groups " + username).strip()
    assert "wheel" in groups, "User not in wheel group: " + groups
    assert "networkmanager" in groups, "User not in networkmanager group: " + groups

    nixpi.succeed("systemctl is-active netbird.service")

    for port in [6167, 8080, 8081, 5000, 8443]:
        client.succeed(f"! nc -z -w 2 pi {port}")

    packages = ["git", "curl", "jq", "htop", "netbird", "chromium"]
    for pkg in packages:
        nixpi.succeed("command -v " + pkg)
    
    nixpi.succeed("getent hosts pi")
    nixpi.succeed("getent hosts client")
    
    print("=" * 60)
    print("All E2E tests passed!")
    print("=" * 60)
    print("Verified:")
    print("  - Matrix homeserver is functional locally on the NixPI node")
    print("  - Firstboot logged unattended setup completion")
    print("  - Matrix self-registration is disabled after setup")
    print("  - SSH is disabled from an untrusted peer after setup")
    print("  - App ports stay closed without wt0")
    print("  - Firstboot automation completes")
    print("  - All core services start correctly")
    print("  - Network connectivity between nodes")
    print("  - File system and user setup correct")
    print("=" * 60)
  '';
}
