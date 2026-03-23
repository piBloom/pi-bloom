# tests/nixos/nixpi-matrix.nix
# Test that the NixPI Matrix homeserver (Continuwuity) starts and accepts connections

{ pkgs, lib, nixPiModules, nixPiModulesNoShell, piAgent, appPackage, setupPackage, mkTestFilesystems, ... }:

pkgs.testers.runNixOSTest {
  name = "nixpi-matrix";

  nodes.server = { ... }: {
    imports = nixPiModules ++ [ mkTestFilesystems ];
    _module.args = { inherit piAgent appPackage setupPackage; };
    nixpi.primaryUser = "tester";

    # VM configuration
    virtualisation.diskSize = 20480;
    virtualisation.memorySize = 4096;

    # Standard system config
    boot.loader.systemd-boot.enable = true;
    boot.loader.efi.canTouchEfiVariables = true;
    networking.hostName = "nixpi-matrix-test";
    time.timeZone = "UTC";
    i18n.defaultLocale = "en_US.UTF-8";
    networking.networkmanager.enable = true;
    system.stateVersion = "25.05";
    # nixpkgs.config NOT set here - test framework injects its own pkgs
  };

  testScript = ''
    server = machines[0]

    # Start the server
    server.start()
    
    # Wait for basic system to be up
    server.wait_for_unit("multi-user.target", timeout=300)
    
    # Wait for the primary interface to be configured
    server.wait_until_succeeds("ip -4 addr show dev eth1 | grep -q 'inet '", timeout=60)
    
    # Test 1: Matrix service starts successfully
    server.wait_for_unit("continuwuity.service", timeout=60)
    
    # Test 2: Matrix homeserver responds to client versions endpoint
    server.succeed("curl -sf http://localhost:6167/_matrix/client/versions")
    
    # Test 3: Registration secret file was created in the stable NixPI
    # secret directory and runtime config was rendered for Continuwuity.
    server.succeed("test -f /var/lib/nixpi/secrets/matrix-registration-shared-secret")
    server.succeed("grep -q 'server_name = \"nixpi-matrix-test\"' /var/lib/continuwuity/continuwuity.toml")
    
    # Test 4: Registration shared secret has correct permissions (readable by service)
    token_perms = server.succeed("stat -c '%a' /var/lib/nixpi/secrets/matrix-registration-shared-secret").strip()
    assert token_perms == "640", f"Unexpected token permissions: {token_perms}"
    
    # Test 5: Can read the shared secret
    token = server.succeed("cat /var/lib/nixpi/secrets/matrix-registration-shared-secret").strip()
    assert len(token) > 0, "Registration token is empty"
    
    # Test 6: Matrix unit is installed
    service_content = server.succeed("systemctl cat continuwuity.service")
    assert "continuwuity" in service_content, "Missing continuwuity unit content"
    
    # Test 7: Service is running under the Continuwuity service user
    status = server.succeed("systemctl show continuwuity.service -p User --value").strip()
    assert status in ["continuwuity", ""] or "dynamic" in status.lower(), f"Unexpected service user: {status}"
    
    # Test 8: State directory exists
    server.succeed("test -d /var/lib/continuwuity")
    
    # Test 9: Service restart works
    old_token = token
    server.succeed("systemctl restart continuwuity.service")
    server.wait_for_unit("continuwuity.service", timeout=60)
    server.succeed("curl -sf http://localhost:6167/_matrix/client/versions")
    new_token = server.succeed("cat /var/lib/nixpi/secrets/matrix-registration-shared-secret").strip()
    assert old_token == new_token, "Matrix registration secret changed across restart"
    
    # Test 10: Service is in wantedBy multi-user.target
    server.succeed("systemctl list-dependencies multi-user.target | grep -q continuwuity")
    
    print("All nixpi-matrix tests passed!")
  '';
}
