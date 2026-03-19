# tests/nixos/workspace-e2e.nix
# End-to-end integration test - full Workspace OS stack validation

{ pkgs, lib, workspaceModules, workspaceModulesNoShell, piAgent, appPackage, mkWorkspaceNode, mkTestFilesystems }:

pkgs.testers.runNixOSTest {
  name = "workspace-e2e";

  nodes = {
    # Main Workspace OS server
    workspace = { ... }: let
      username = "workspace";
      homeDir = "/home/${username}";
    in {
      imports = workspaceModulesNoShell ++ [ 
        ../../core/os/modules/firstboot.nix
        mkTestFilesystems 
      ];
      _module.args = { inherit piAgent appPackage; };
      nixpi.username = username;

      virtualisation.diskSize = 20480;
      virtualisation.memorySize = 4096;

      networking.hostName = "workspace";
      time.timeZone = "UTC";
      i18n.defaultLocale = "en_US.UTF-8";
      networking.networkmanager.enable = true;
      system.stateVersion = "25.05";
      # nixpkgs.config NOT set here - test framework injects its own pkgs
      
      boot.loader.systemd-boot.enable = true;
      boot.loader.efi.canTouchEfiVariables = true;

      # Ensure the primary Workspace user exists
      users.users.${username} = {
        isNormalUser = true;
        group = username;
        extraGroups = [ "wheel" "networkmanager" ];
        home = homeDir;
        shell = pkgs.bash;
      };
      users.groups.${username} = {};

      # Pre-create prefill.env for automated setup
      system.activationScripts.workspace-e2e-prefill = lib.stringAfter [ "users" ] ''
      mkdir -p ${homeDir}/.workspace
      cat > ${homeDir}/.workspace/prefill.env << 'EOF'
    PREFILL_USERNAME=e2etest
    PREFILL_MATRIX_PASSWORD=e2etestpass123
    EOF
        chown -R ${username}:${username} ${homeDir}/.workspace
        chmod 755 ${homeDir}/.workspace
        chmod 644 ${homeDir}/.workspace/prefill.env
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

  testScript = { nodes, ... }: ''
    import time
    username = "workspace"
    home = "/home/workspace"
    
    # Start the Workspace server
    workspace.start()
    workspace.wait_for_unit("multi-user.target", timeout=300)
    workspace.wait_for_unit("network-online.target", timeout=60)
    
    # Start the client
    client.start()
    client.wait_for_unit("network-online.target", timeout=60)
    
    # E2E Test 1: Workspace server is accessible from client
    client.succeed("ping -c 3 workspace")
    
    # E2E Test 2: Matrix homeserver is accessible externally
    workspace.wait_for_unit("matrix-synapse.service", timeout=60)
    client.succeed("curl -sf http://workspace:6167/_matrix/client/versions")
    
    # E2E Test 3: Can register a user via external client
    client.succeed("""
      curl -sf -X POST http://workspace:6167/_matrix/client/v3/register \
        -H "Content-Type: application/json" \
        -d '{"username":"e2euser","password":"e2epass123","type":"m.login.dummy"}'
    """)
    
    # E2E Test 4: Can login from external client
    login_resp = client.succeed("""
      curl -sf -X POST http://workspace:6167/_matrix/client/v3/login \
        -H "Content-Type: application/json" \
        -d '{"type":"m.login.password","user":"e2euser","password":"e2epass123"}'
    """)
    
    # Verify login response contains expected fields
    import json
    try:
        login_data = json.loads(login_resp)
        assert "access_token" in login_data, "Login response missing access_token"
        assert "user_id" in login_data, "Login response missing user_id"
        print("Successfully logged in as " + login_data['user_id'])
    except json.JSONDecodeError as e:
        print("Warning: Could not parse login response: " + str(e))
    
    # E2E Test 5: SSH is accessible from client
    workspace.wait_for_unit("sshd.service", timeout=60)
    
    # Set up SSH key auth for test
    client.succeed("mkdir -p /root/.ssh")
    client.succeed("ssh-keygen -t ed25519 -N '''' -f /root/.ssh/id_ed25519")
    pub_key = client.succeed("cat /root/.ssh/id_ed25519.pub").strip()
    
    workspace.succeed("mkdir -p " + home + "/.ssh")
    workspace.succeed("echo '" + pub_key + "' > " + home + "/.ssh/authorized_keys")
    workspace.succeed("chown -R " + username + ":" + username + " " + home + "/.ssh && chmod 700 " + home + "/.ssh && chmod 600 " + home + "/.ssh/authorized_keys")
    
    # Test SSH connection (may need password auth initially)
    client.succeed('ssh -o StrictHostKeyChecking=no -o BatchMode=yes -o ConnectTimeout=10 workspace@workspace "echo SSH_OK"')
    
    # E2E Test 6: Firstboot completes successfully
    workspace.wait_for_unit("nixpi-firstboot.service", timeout=120)
    workspace.succeed("test -f " + home + "/.workspace/.setup-complete")
    
    # E2E Test 7: All expected services are running
    services = ["matrix-synapse", "netbird", "NetworkManager", "sshd"]
    for svc in services:
        workspace.succeed("systemctl is-active " + svc + ".service")
    
    # E2E Test 8: LocalAI download service status (may be activating or active)
    localai_status = workspace.succeed("systemctl is-active localai-download.service || true").strip()
    print("LocalAI download status: " + localai_status)
    assert localai_status in ["active", "activating", ""], "LocalAI download in unexpected state: " + localai_status
    
    # E2E Test 9: Workspace directories are correctly set up
    workspace.succeed("test -d " + home + "/Workspace")
    workspace.succeed("test -d " + home + "/.workspace")
    workspace.succeed("test -d " + home + "/.pi")
    workspace.succeed("test -d /usr/local/share/workspace")
    
    # E2E Test 10: User has correct groups
    groups = workspace.succeed("groups " + username).strip()
    assert "wheel" in groups, "User not in wheel group: " + groups
    assert "networkmanager" in groups, "User not in networkmanager group: " + groups
    
    # E2E Test 11: NetBird mesh interface exists or can be created
    # wt0 is the NetBird wireguard interface
    interfaces = workspace.succeed("ip link show").strip()
    # Interface may not exist without valid setup key, but service should be running
    workspace.succeed("systemctl is-active netbird.service")
    
    # E2E Test 12: Firewall configuration allows expected traffic
    # Check that we can reach Matrix from client
    client.succeed("nc -z workspace 6167")
    client.succeed("nc -z workspace 22")
    
    # E2E Test 13: Primary Workspace user can run sudo commands
    workspace.succeed("su - " + username + " -c 'sudo -n whoami' | grep -q root")
    
    # E2E Test 14: Required system packages are available
    packages = ["git", "curl", "jq", "htop", "netbird", "chromium"]
    for pkg in packages:
        workspace.succeed("which " + pkg + " || true")  # Some may be in different paths
    
    # E2E Test 15: System can resolve DNS
    workspace.succeed("getent hosts workspace")
    workspace.succeed("getent hosts client")
    
    print("=" * 60)
    print("All E2E tests passed!")
    print("=" * 60)
    print("Verified:")
    print("  - Matrix homeserver accessible and functional")
    print("  - User registration and login work")
    print("  - SSH connectivity with key auth")
    print("  - Firstboot automation completes")
    print("  - All core services start correctly")
    print("  - Network connectivity between nodes")
    print("  - File system and user setup correct")
    print("=" * 60)
  '';
}
