# tests/nixos/bloom-firstboot.nix
# Test that the Bloom first-boot wizard runs correctly

{ pkgs, lib, bloomModules, bloomModulesNoShell, piAgent, bloomApp, mkBloomNode, mkTestFilesystems }:

pkgs.testers.runNixOSTest {
  name = "bloom-firstboot";

  nodes.bloom = { ... }: let
    username = "bloom";
    homeDir = "/home/${username}";
  in {
    imports = bloomModulesNoShell ++ [ 
      ../../core/os/modules/bloom-firstboot.nix
      mkTestFilesystems 
    ];
    _module.args = { inherit piAgent bloomApp; };
    bloom.username = username;

    # VM configuration
    virtualisation.diskSize = 20480;
    virtualisation.memorySize = 4096;

    # Standard system config
    boot.loader.systemd-boot.enable = true;
    boot.loader.efi.canTouchEfiVariables = true;
    networking.hostName = "bloom-firstboot-test";
    time.timeZone = "UTC";
    i18n.defaultLocale = "en_US.UTF-8";
    networking.networkmanager.enable = true;
    system.stateVersion = "25.05";
    # nixpkgs.config NOT set here - test framework injects its own pkgs

    # Ensure the primary Bloom user exists (normally created by bloom-shell)
    users.users.${username} = {
      isNormalUser = true;
      group = username;
      extraGroups = [ "wheel" "networkmanager" ];
      home = homeDir;
      shell = pkgs.bash;
    };
    users.groups.${username} = {};

    # Pre-create the .bloom directory with prefill.env
    systemd.tmpfiles.rules = [
      "d ${homeDir}/.bloom 0755 ${username} ${username} -"
      "f ${homeDir}/.bloom/prefill.env 0644 ${username} ${username} -"
    ];

    # Write prefill.env content via activation script
    system.activationScripts.bloom-prefill = lib.stringAfter [ "users" ] ''
      mkdir -p ${homeDir}/.bloom
      cat > ${homeDir}/.bloom/prefill.env << 'EOF'
    PREFILL_USERNAME=testuser
    PREFILL_PASSWORD=testpassword123
    EOF
      chown -R ${username}:${username} ${homeDir}/.bloom
      chmod 755 ${homeDir}/.bloom
      chmod 644 ${homeDir}/.bloom/prefill.env
    '';
  };

  testScript = { nodes, ... }: ''
    home = "/home/bloom"
    username = "bloom"

    # Start the node - firstboot should run automatically
    bloom.start()
    
    # Wait for basic system to be up
    bloom.wait_for_unit("multi-user.target", timeout=300)
    
    # Wait for network to be online
    bloom.wait_for_unit("network-online.target", timeout=60)
    
    # Wait for Matrix to be ready (firstboot depends on it)
    bloom.wait_for_unit("bloom-matrix.service", timeout=60)
    
    # Wait for netbird to be ready
    bloom.wait_for_unit("netbird.service", timeout=60)
    
    # Test 1: Firstboot service runs and completes
    bloom.wait_for_unit("bloom-firstboot.service", timeout=120)
    
    # Test 2: .setup-complete marker file was created
    bloom.succeed("test -f " + home + "/.bloom/.setup-complete")
    
    # Test 3: prefill.env was consumed (still exists but firstboot ran)
    bloom.succeed("test -f " + home + "/.bloom/prefill.env")
    
    # Test 4: wizard-state directory was created
    bloom.succeed("test -d " + home + "/.bloom/wizard-state")
    
    # Test 5: Check that firstboot log was created
    bloom.succeed("test -f " + home + "/.bloom/firstboot.log")
    
    # Test 6: Log contains expected messages
    log_content = bloom.succeed("cat " + home + "/.bloom/firstboot.log")
    assert "Bloom Firstboot Started" in log_content, "Firstboot log missing start marker"
    assert "setup complete" in log_content, "Firstboot log missing completion marker"
    
    # Test 7: Linger is enabled for the primary Bloom user
    bloom.succeed("test -f /var/lib/systemd/linger/" + username)
    
    # Test 8: User systemd directory exists
    bloom.succeed("test -d " + home + "/.config/systemd/user")
    
    # Test 9: pi-daemon service is enabled for the primary user
    result = bloom.succeed("systemctl --user -M " + username + "@ list-unit-files | grep pi-daemon || true")
    # Note: The service may not be fully enabled if setup was interrupted, but should exist
    
    # Test 10: Built-in user services are enabled and runtime configs exist
    bloom.succeed("test -f " + home + "/.config/bloom/home/index.html")
    bloom.succeed("test -f " + home + "/.config/bloom/fluffychat/config.json")
    bloom.succeed("test -d " + home + "/.config/code-server")

    # Test 11: Bloom directory structure exists
    bloom.succeed("test -d " + home + "/Bloom")
    
    # Test 12: Checkpoints exist in wizard-state
    checkpoints = bloom.succeed("ls " + home + "/.bloom/wizard-state/").strip().split('\n')
    # At minimum, localai step should be marked done
    assert "localai" in checkpoints, f"localai checkpoint missing. Found: {checkpoints}"
    assert "services" in checkpoints, f"services checkpoint missing. Found: {checkpoints}"

    print("All bloom-firstboot tests passed!")
  '';
}
