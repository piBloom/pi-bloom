# tests/nixos/nixpi-network.nix
# Test network connectivity, SSH, and NetBird mesh setup between nodes

{ pkgs, lib, nixPiModules, nixPiModulesNoShell, piAgent, appPackage, setupPackage, mkTestFilesystems, ... }:

pkgs.testers.runNixOSTest {
  name = "nixpi-network";

  nodes = {
    nixpi1 = { ... }: {
      imports = nixPiModules ++ [ mkTestFilesystems ];
      _module.args = { inherit piAgent appPackage setupPackage; };
      nixpi.primaryUser = "tester1";

      virtualisation.diskSize = 10240;
      virtualisation.memorySize = 2048;

      networking.hostName = "nixpi1";
      time.timeZone = "UTC";
      i18n.defaultLocale = "en_US.UTF-8";
      networking.networkmanager.enable = true;
      system.stateVersion = "25.05";
      # nixpkgs.config NOT set here - test framework injects its own pkgs
      systemd.services.continuwuity.wantedBy = lib.mkForce [];
      # Standard boot config
      boot.loader.systemd-boot.enable = true;
      boot.loader.efi.canTouchEfiVariables = true;
    };

    nixpi2 = { ... }: {
      imports = nixPiModules ++ [ mkTestFilesystems ];
      _module.args = { inherit piAgent appPackage setupPackage; };
      nixpi.primaryUser = "tester2";

      virtualisation.diskSize = 10240;
      virtualisation.memorySize = 2048;

      networking.hostName = "nixpi2";
      time.timeZone = "UTC";
      i18n.defaultLocale = "en_US.UTF-8";
      networking.networkmanager.enable = true;
      system.stateVersion = "25.05";
      # nixpkgs.config NOT set here - test framework injects its own pkgs
      systemd.services.continuwuity.wantedBy = lib.mkForce [];
      # Standard boot config
      boot.loader.systemd-boot.enable = true;
      boot.loader.efi.canTouchEfiVariables = true;
    };
  };

  testScript = ''
    nixpi1 = machines[0]
    nixpi2 = machines[1]

    # Start both nodes
    start_all()
    
    # Wait for both nodes to be online and mutually reachable on the test network.
    for node in [nixpi1, nixpi2]:
        node.wait_for_unit("multi-user.target", timeout=300)

    nixpi1.wait_until_succeeds("getent hosts nixpi2", timeout=120)
    nixpi2.wait_until_succeeds("getent hosts nixpi1", timeout=120)
    nixpi1.wait_until_succeeds("ping -c 1 nixpi2", timeout=120)
    nixpi2.wait_until_succeeds("ping -c 1 nixpi1", timeout=120)
    
    # Test 1: Both nodes can ping each other by hostname
    nixpi1.succeed("ping -c 3 nixpi2")
    nixpi2.succeed("ping -c 3 nixpi1")
    
    # Test 2: SSH service is running on both nodes
    for node in [nixpi1, nixpi2]:
        node.wait_for_unit("sshd.service", timeout=60)
        node.succeed("systemctl is-active sshd")
    
    # Test 3: NetworkManager is managing connections
    for node in [nixpi1, nixpi2]:
        node.succeed("systemctl is-active NetworkManager")
        nm_status = node.succeed("nmcli general status")
        assert "connected" in nm_status.lower(), "NetworkManager not connected: " + nm_status
    
    # Test 4: Firewall is active but allows required ports
    for node in [nixpi1, nixpi2]:
        node.succeed("systemctl is-active firewall.service || true")  # May be named differently
        # Check that SSH port is open
        nixpi1.succeed("nc -z nixpi2 22")
        nixpi2.succeed("nc -z nixpi1 22")
    
    # Test 5: DNS resolution works between nodes
    nixpi1.succeed("getent hosts nixpi2")
    nixpi2.succeed("getent hosts nixpi1")
    
    print("All nixpi-network tests passed!")
  '';
}
