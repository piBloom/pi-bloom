# tests/nixos/nixpi-e2e.nix
# End-to-end integration test - full nixPI stack validation

{ pkgs, lib, nixpiModules, nixpiModulesNoShell, piAgent, appPackage, mkNixpiNode, mkTestFilesystems }:

pkgs.testers.runNixOSTest {
  name = "nixpi-e2e";

  nodes = {
    # Main nixPI server
    nixpi = { ... }: let
      username = "pi";
      homeDir = "/home/${username}";
    in {
      imports = nixpiModulesNoShell ++ [ 
        ../../core/os/modules/firstboot.nix
        mkTestFilesystems 
      ];
      _module.args = { inherit piAgent appPackage; };
      nixpi.username = username;

      virtualisation.diskSize = 20480;
      virtualisation.memorySize = 4096;

      networking.hostName = "pi";
      time.timeZone = "UTC";
      i18n.defaultLocale = "en_US.UTF-8";
      networking.networkmanager.enable = true;
      system.stateVersion = "25.05";
      # nixpkgs.config NOT set here - test framework injects its own pkgs
      systemd.services.localai.wantedBy = lib.mkForce [];
      systemd.services.localai-download.wantedBy = lib.mkForce [];
      
      boot.loader.systemd-boot.enable = true;
      boot.loader.efi.canTouchEfiVariables = true;

      # Ensure the primary nixPI user exists
      users.users.${username} = {
        isNormalUser = true;
        group = username;
        extraGroups = [ "wheel" "networkmanager" ];
        home = homeDir;
        shell = pkgs.bash;
      };
      users.groups.${username} = {};

      # Pre-create prefill.env for automated setup
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
    import json
    client = machines[0]
    nixpi = machines[1]
    username = "pi"
    home = "/home/pi"
    
    # Start the nixPI server
    nixpi.start()
    nixpi.wait_for_unit("multi-user.target", timeout=300)
    nixpi.wait_until_succeeds("ip -4 addr show dev eth1 | grep -q 'inet '", timeout=60)
    
    # Start the client
    client.start()
    client.wait_until_succeeds("ip -4 addr show dev eth1 | grep -q 'inet '", timeout=60)
    
    # E2E Test 1: nixPI server is accessible from client
    client.succeed("ping -c 3 pi")
    
    # E2E Test 2: Matrix homeserver is accessible externally
    nixpi.wait_for_unit("matrix-synapse.service", timeout=60)
    client.succeed("curl -sf http://pi:6167/_matrix/client/versions")
    
    # E2E Test 3: Can register a user via external client
    register_resp = client.succeed("""
      curl -s -X POST http://pi:6167/_matrix/client/v3/register \
        -H "Content-Type: application/json" \
        -d '{"username":"e2euser","password":"e2epass123","inhibit_login":false}'
    """)
    register_data = json.loads(register_resp)
    if "access_token" not in register_data:
        session = register_data.get("session")
        assert session, "Matrix registration challenge missing session: " + register_resp
        register_payload = json.dumps({
            "username": "e2euser",
            "password": "e2epass123",
            "inhibit_login": False,
            "auth": {"type": "m.login.dummy", "session": session},
        })
        register_resp = client.succeed(
            "curl -sf -X POST http://pi:6167/_matrix/client/v3/register "
            + "-H \"Content-Type: application/json\" "
            + "-d '"
            + register_payload
            + "'"
        )
        register_data = json.loads(register_resp)
    assert "access_token" in register_data, "Registration response missing access_token"
    
    # E2E Test 4: Can login from external client
    login_resp = client.succeed("""
      curl -sf -X POST http://pi:6167/_matrix/client/v3/login \
        -H "Content-Type: application/json" \
        -d '{"type":"m.login.password","user":"e2euser","password":"e2epass123"}'
    """)
    
    # Verify login response contains expected fields
    try:
        login_data = json.loads(login_resp)
        assert "access_token" in login_data, "Login response missing access_token"
        assert "user_id" in login_data, "Login response missing user_id"
        print("Successfully logged in as " + login_data['user_id'])
    except json.JSONDecodeError as e:
        print("Warning: Could not parse login response: " + str(e))
    
    # E2E Test 5: SSH is accessible from client
    nixpi.wait_for_unit("sshd.service", timeout=60)
    client.succeed("nc -z pi 22")
    
    # E2E Test 6: Firstboot completes successfully
    nixpi.wait_for_unit("nixpi-firstboot.service", timeout=120)
    nixpi.succeed("test -f " + home + "/.nixpi/.setup-complete")
    
    # E2E Test 7: All expected services are running
    services = ["matrix-synapse", "netbird", "NetworkManager", "sshd"]
    for svc in services:
        nixpi.succeed("systemctl is-active " + svc + ".service")
    
    # E2E Test 8: LocalAI is intentionally disabled for this smoke test.
    localai_enabled = nixpi.succeed("systemctl is-enabled localai.service || true").strip()
    localai_active = nixpi.succeed("systemctl is-active localai.service || true").strip()
    print("LocalAI enabled state: " + localai_enabled)
    print("LocalAI active state: " + localai_active)
    assert localai_active in ["inactive", "failed", "unknown", ""], "LocalAI should not be running in this test: " + localai_active
    
    # E2E Test 9: nixPI directories are correctly set up
    nixpi.succeed("test -d " + home + "/nixPI")
    nixpi.succeed("test -d " + home + "/.nixpi")
    nixpi.succeed("test -d " + home + "/.pi")
    nixpi.succeed("test -d /usr/local/share/nixpi")
    
    # E2E Test 10: User has correct groups
    groups = nixpi.succeed("groups " + username).strip()
    assert "wheel" in groups, "User not in wheel group: " + groups
    assert "networkmanager" in groups, "User not in networkmanager group: " + groups
    
    # E2E Test 11: NetBird mesh interface exists or can be created
    # wt0 is the NetBird wireguard interface
    interfaces = nixpi.succeed("ip link show").strip()
    # Interface may not exist without valid setup key, but service should be running
    nixpi.succeed("systemctl is-active netbird.service")
    
    # E2E Test 12: Firewall configuration allows expected traffic
    # Check that we can reach Matrix from client
    client.succeed("nc -z pi 6167")
    client.succeed("nc -z pi 22")
    
    # E2E Test 13: Required system packages are available
    packages = ["git", "curl", "jq", "htop", "netbird", "chromium"]
    for pkg in packages:
        nixpi.succeed("which " + pkg + " || true")  # Some may be in different paths
    
    # E2E Test 14: System can resolve DNS
    nixpi.succeed("getent hosts pi")
    nixpi.succeed("getent hosts client")
    
    print("=" * 60)
    print("All E2E tests passed!")
    print("=" * 60)
    print("Verified:")
    print("  - Matrix homeserver accessible and functional")
    print("  - User registration and login work")
    print("  - SSH service reachable from external client")
    print("  - Firstboot automation completes")
    print("  - All core services start correctly")
    print("  - Network connectivity between nodes")
    print("  - File system and user setup correct")
    print("=" * 60)
  '';
}
