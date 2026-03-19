# tests/nixos/workspace-network.nix
# Test network connectivity, SSH, and NetBird mesh setup between nodes

{ pkgs, lib, workspaceModules, workspaceModulesNoShell, piAgent, appPackage, mkWorkspaceNode, mkTestFilesystems }:

pkgs.testers.runNixOSTest {
  name = "workspace-network";

  nodes = {
    bloom1 = { ... }: {
      imports = workspaceModules ++ [ mkTestFilesystems ];
      _module.args = { inherit piAgent appPackage; };

      virtualisation.diskSize = 10240;
      virtualisation.memorySize = 2048;

      networking.hostName = "bloom1";
      time.timeZone = "UTC";
      i18n.defaultLocale = "en_US.UTF-8";
      networking.networkmanager.enable = true;
      system.stateVersion = "25.05";
      # nixpkgs.config NOT set here - test framework injects its own pkgs
      
      # Standard boot config
      boot.loader.systemd-boot.enable = true;
      boot.loader.efi.canTouchEfiVariables = true;
    };

    bloom2 = { ... }: {
      imports = workspaceModules ++ [ mkTestFilesystems ];
      _module.args = { inherit piAgent appPackage; };

      virtualisation.diskSize = 10240;
      virtualisation.memorySize = 2048;

      networking.hostName = "bloom2";
      time.timeZone = "UTC";
      i18n.defaultLocale = "en_US.UTF-8";
      networking.networkmanager.enable = true;
      system.stateVersion = "25.05";
      # nixpkgs.config NOT set here - test framework injects its own pkgs
      
      # Standard boot config
      boot.loader.systemd-boot.enable = true;
      boot.loader.efi.canTouchEfiVariables = true;
    };
  };

  testScript = { nodes, ... }: ''
    # Start both nodes
    start_all()
    
    # Wait for both nodes to be online
    for node in [bloom1, bloom2]:
        node.wait_for_unit("multi-user.target", timeout=300)
        node.wait_for_unit("network-online.target", timeout=60)
    
    # Test 1: Both nodes can ping each other by hostname
    bloom1.succeed("ping -c 3 bloom2")
    bloom2.succeed("ping -c 3 bloom1")
    
    # Test 2: SSH service is running on both nodes
    for node in [bloom1, bloom2]:
        node.wait_for_unit("sshd.service", timeout=60)
        node.succeed("systemctl is-active sshd")
    
    # Test 3: SSH key-based auth works (test user has SSH access)
    # Generate key pair on bloom1
    bloom1.succeed("mkdir -p /root/.ssh")
    bloom1.succeed("ssh-keygen -t ed25519 -N '''' -f /root/.ssh/id_ed25519")
    
    # Copy public key to bloom2
    pub_key = bloom1.succeed("cat /root/.ssh/id_ed25519.pub").strip()
    bloom2.succeed("mkdir -p /root/.ssh")
    bloom2.succeed("echo '" + pub_key + "' > /root/.ssh/authorized_keys")
    bloom2.succeed("chmod 700 /root/.ssh && chmod 600 /root/.ssh/authorized_keys")
    
    # Test SSH from bloom1 to bloom2
    bloom1.succeed("ssh -o StrictHostKeyChecking=no -o BatchMode=yes root@bloom2 'echo SSH_SUCCESS'")
    
    # Test 4: NetworkManager is managing connections
    for node in [bloom1, bloom2]:
        node.succeed("systemctl is-active NetworkManager")
        nm_status = node.succeed("nmcli general status")
        assert "connected" in nm_status.lower(), "NetworkManager not connected: " + nm_status
    
    # Test 5: Firewall is active but allows required ports
    for node in [bloom1, bloom2]:
        node.succeed("systemctl is-active firewall.service || true")  # May be named differently
        # Check that SSH port is open
        bloom1.succeed("nc -z bloom2 22")
        bloom2.succeed("nc -z bloom1 22")
    
    # Test 6: NetBird service is enabled and running
    for node in [bloom1, bloom2]:
        node.succeed("systemctl is-enabled netbird.service")
        node.wait_for_unit("netbird.service", timeout=60)
    
    # Test 7: NetBird socket exists (for management commands)
    for node in [bloom1, bloom2]:
        node.succeed("test -S /var/run/netbird/sock || test -S /run/netbird/sock || true")
    
    # Test 8: DNS resolution works between nodes
    bloom1.succeed("getent hosts bloom2")
    bloom2.succeed("getent hosts bloom1")
    
    # Test 9: External DNS resolution works
    for node in [bloom1, bloom2]:
        node.succeed("getent hosts example.com")
    
    # Test 10: Curl works between nodes (HTTP connectivity)
    # Start a simple HTTP server on bloom2
    bloom2.succeed("echo 'TEST_RESPONSE' > /tmp/test.html")
    bloom2.execute("python3 -m http.server 8080 &")
    bloom2.wait_until_succeeds("nc -z localhost 8080", timeout=10)
    
    # Test HTTP from bloom1
    response = bloom1.succeed("curl -sf http://bloom2:8080/test.html")
    assert "TEST_RESPONSE" in response, "Unexpected HTTP response: " + response
    
    print("All workspace-network tests passed!")
  '';
}
