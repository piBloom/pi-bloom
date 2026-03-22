# tests/nixos/nixpi-e2e.nix
# End-to-end integration test - full NixPI stack validation

{ pkgs, lib, nixPiModules, nixPiModulesNoShell, piAgent, appPackage, setupPackage, mkNixPiNode, mkTestFilesystems, ... }:

pkgs.testers.runNixOSTest {
  name = "nixpi-e2e";

  nodes = {
    # Main NixPI server
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
      # nixpkgs.config NOT set here - test framework injects its own pkgs
      
      boot.loader.systemd-boot.enable = true;
      boot.loader.efi.canTouchEfiVariables = true;

      # Ensure the primary NixPI user exists
      users.users.${username} = {
        isNormalUser = true;
        group = username;
        extraGroups = [ "wheel" "networkmanager" "agent" ];
        home = homeDir;
        shell = pkgs.bash;
      };
      users.groups.${username} = {};
      services.matrix-continuwuity.settings = {
        admin_execute = [ "users create pi pi-bot-pass123" ];
      };

      # Pre-create prefill.env for automated setup
      system.activationScripts.nixpi-e2e-prefill = lib.stringAfter [ "users" ] ''
      mkdir -p ${homeDir}/.nixpi
      cat > ${homeDir}/.nixpi/prefill.env << 'EOF'
    PREFILL_USERNAME=e2etest
    PREFILL_MATRIX_PASSWORD=e2etestpass123
    EOF
        mkdir -p ${homeDir}/.nixpi/wizard-state/matrix-state
        printf '%s' 'pi-bot-pass123' > ${homeDir}/.nixpi/wizard-state/matrix-state/bot_password
        chown -R ${username}:${username} ${homeDir}/.nixpi
        chmod 755 ${homeDir}/.nixpi
        chmod 644 ${homeDir}/.nixpi/prefill.env
      '';
    };

    # External client node
    client = { ... }: {
      virtualisation.diskSize = 5120;
      virtualisation.memorySize = 1024;

      networking.hostName = "client";
      time.timeZone = "UTC";
      i18n.defaultLocale = "en_US.UTF-8";
      networking.networkmanager.enable = true;
      system.stateVersion = "25.05";
      # nixpkgs.config NOT set here - test framework injects its own pkgs
      
      boot.loader.systemd-boot.enable = true;
      boot.loader.efi.canTouchEfiVariables = true;

      # Client tools
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
    
    # Start the NixPI server
    nixpi.start()
    nixpi.wait_for_unit("multi-user.target", timeout=300)
    nixpi.wait_until_succeeds("ip -4 addr show dev eth1 | grep -q 'inet '", timeout=60)
    
    # Start the client
    client.start()
    client.wait_until_succeeds("ip -4 addr show dev eth1 | grep -q 'inet '", timeout=60)
    
    # E2E Test 1: NixPI server is accessible from client
    client.succeed("ping -c 3 pi")
    
    # E2E Test 2: Wizard completes and the system reaches its steady state
    nixpi.succeed("su - pi -c 'setup-wizard.sh'")
    nixpi.wait_until_succeeds("test -f " + home + "/.nixpi/.setup-complete", timeout=180)

    # E2E Test 3: Matrix homeserver is available locally on the NixPI node
    nixpi.wait_for_unit("continuwuity.service", timeout=60)
    nixpi.succeed("curl -sf http://127.0.0.1:6167/_matrix/client/versions")

    # E2E Test 4: Wizard logged its completion in unattended mode
    wizard_log = nixpi.succeed("cat " + home + "/.nixpi/wizard.log")
    assert "setup complete" in wizard_log.lower(), "Wizard log missing setup completion marker"
    
    # E2E Test 5: Registration is disabled in the steady state
    register_status = nixpi.succeed("""
      curl -s -o /tmp/e2e-register.out -w '%{http_code}' -X POST http://127.0.0.1:6167/_matrix/client/v3/register \
        -H "Content-Type: application/json" \
        -d '{"username":"blocked","password":"blockedpass123","inhibit_login":false}'
    """).strip()
    assert register_status != "200", "Expected registration to be disabled, got HTTP " + register_status

    # E2E Test 6: SSH is disabled from an untrusted peer after setup
    client.succeed("! nc -z -w 2 pi 22")
    nixpi.succeed("systemctl show -p ActiveState --value sshd.service | grep -Eq 'inactive|failed'")
    
    # E2E Test 7: All expected services are running
    services = ["continuwuity", "netbird", "NetworkManager"]
    for svc in services:
        nixpi.succeed("systemctl is-active " + svc + ".service")
    
    # E2E Test 8: NixPI directories are correctly set up
    nixpi.succeed("test -d " + home + "/nixpi")
    nixpi.succeed("test -d " + home + "/.nixpi")
    nixpi.succeed("test -d " + home + "/.pi")
    nixpi.succeed("test -d /var/lib/nixpi/agent")
    nixpi.succeed("test \"$(readlink -f " + home + "/.pi)\" = /var/lib/nixpi/agent")
    nixpi.succeed("test -d /usr/local/share/nixpi")
    
    # E2E Test 10: User has correct groups
    groups = nixpi.succeed("groups " + username).strip()
    assert "wheel" in groups, "User not in wheel group: " + groups
    assert "networkmanager" in groups, "User not in networkmanager group: " + groups
    assert "agent" in groups, "User not in agent group: " + groups
    
    # E2E Test 11: NetBird service is installed and active even without a setup key
    nixpi.succeed("systemctl is-active netbird.service")

    # E2E Test 12: Firewall keeps app ports closed to an untrusted peer
    for port in [6167, 8080, 8081, 5000, 8443]:
        client.succeed(f"! nc -z -w 2 pi {port}")

    # E2E Test 13: Required system packages are available
    packages = ["git", "curl", "jq", "htop", "netbird", "chromium"]
    for pkg in packages:
        nixpi.succeed("command -v " + pkg)
    
    # E2E Test 14: System can resolve DNS
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
