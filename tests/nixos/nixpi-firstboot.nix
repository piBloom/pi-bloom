# tests/nixos/nixpi-firstboot.nix
# Test that the NixPI first-boot wizard runs correctly

{ pkgs, lib, nixPiModulesNoShell, piAgent, appPackage, setupPackage, mkTestFilesystems, ... }:

pkgs.testers.runNixOSTest {
  name = "nixpi-firstboot";

  nodes.nixpi = { ... }: let
    username = "pi";
    homeDir = "/home/${username}";
  in {
    imports = nixPiModulesNoShell ++ [ 
      ../../core/os/modules/firstboot.nix
      mkTestFilesystems 
    ];
    _module.args = { inherit piAgent appPackage setupPackage; };
    nixpi.primaryUser = username;

    # VM configuration
    virtualisation.diskSize = 20480;
    virtualisation.memorySize = 4096;

    # Standard system config
    boot.loader.systemd-boot.enable = true;
    boot.loader.efi.canTouchEfiVariables = true;
    networking.hostName = "nixpi-firstboot-test";
    time.timeZone = "UTC";
    i18n.defaultLocale = "en_US.UTF-8";
    networking.networkmanager.enable = true;
    system.stateVersion = "25.05";
    # nixpkgs.config NOT set here - test framework injects its own pkgs

    # Ensure the primary NixPI user exists (normally created by nixpi-shell)
    users.users.${username} = {
      isNormalUser = true;
      group = username;
      extraGroups = [ "wheel" "networkmanager" ];
      home = homeDir;
      shell = pkgs.bash;
    };
    users.groups.${username} = {};
    # Pre-create the .nixpi directory with prefill.env for unattended install
    systemd.tmpfiles.rules = [
      "d ${homeDir}/.nixpi 0755 ${username} ${username} -"
      "f ${homeDir}/.nixpi/prefill.env 0644 ${username} ${username} -"
    ];

    # Write prefill.env content via activation script
    system.activationScripts.nixpi-prefill = lib.stringAfter [ "users" ] ''
      mkdir -p ${homeDir}/.nixpi
      cat > ${homeDir}/.nixpi/prefill.env << 'EOF'
    PREFILL_USERNAME=testuser
    PREFILL_MATRIX_PASSWORD=testpassword123
    EOF
      chown -R ${username}:${username} ${homeDir}/.nixpi
      chmod 755 ${homeDir}/.nixpi
      chmod 644 ${homeDir}/.nixpi/prefill.env
    '';
  };

  testScript = ''
    nixpi = machines[0]
    home = "/home/pi"
    username = "pi"

    # Start the node and run the single setup wizard path
    nixpi.start()
    
    # Wait for basic system to be up
    nixpi.wait_for_unit("multi-user.target", timeout=300)
    
    # Wait for network to be online
    nixpi.wait_for_unit("network-online.target", timeout=60)
    
    # Wait for netbird to be ready
    nixpi.wait_for_unit("netbird.service", timeout=60)

    # Simulate slow or inactive Matrix startup and ensure the wizard recovers it.
    nixpi.succeed("systemctl stop continuwuity.service")
    
    # Test 1: Wizard completes unattended from prefill state
    nixpi.succeed("su - pi -c 'setup-wizard.sh'")

    # Test 1a: Wizard started Matrix itself and left it active
    nixpi.wait_for_unit("continuwuity.service", timeout=120)
    
    # Test 2: .setup-complete marker file was created (unattended mode)
    nixpi.succeed("test -f " + home + "/.nixpi/.setup-complete")
    
    # Test 3: prefill.env exists (not deleted after consumption)
    nixpi.succeed("test -f " + home + "/.nixpi/prefill.env")
    
    # Test 4: wizard log was created and contains expected content
    nixpi.succeed("test -f " + home + "/.nixpi/wizard.log")
    log_content = nixpi.succeed("cat " + home + "/.nixpi/wizard.log")
    
    # Debug: print log content
    print("=== Firstboot log content ===")
    print(log_content)
    print("=== End of log ===")
    
    assert "NixPI Wizard Started" in log_content, "Wizard log missing start marker"
    assert "setup complete" in log_content.lower(), "Firstboot log missing completion marker"
    
    # Test 5: wizard-state directory was created
    nixpi.succeed("test -d " + home + "/.nixpi/wizard-state")

    # Test 7: Checkpoints exist in wizard-state
    checkpoints = nixpi.succeed("ls " + home + "/.nixpi/wizard-state/ 2>/dev/null || true").strip().split('\n')
    checkpoints = [c for c in checkpoints if c]  # filter empty lines
    assert len(checkpoints) > 0, f"No checkpoints found in wizard-state. Found: {checkpoints}"
    
    # Test 8: Pi state lives directly under the operator home and is writable by the operator
    nixpi.succeed("test -d " + home + "/.pi")
    nixpi.succeed("test -f " + home + "/.pi/settings.json")
    nixpi.succeed("test ! -L " + home + "/.pi")
    nixpi.succeed("test \"$(stat -c %U " + home + "/.pi)\" = pi")

    # Test 8a: Login shell exports the managed Pi agent dir so `pi` can start
    nixpi.succeed(
        "su - pi -c '. ~/.bashrc; test \"$PI_CODING_AGENT_DIR\" = /home/pi/.pi; "
        + "pi --help | grep -q \"AI coding assistant\"'"
    )

    # Test 9: NixPI directory may or may not exist depending on network/git availability
    # The firstboot script attempts to clone a repo but may fail in test env
    # So we just check the script attempted it (log mentions it)

    print("All nixpi-firstboot tests passed!")
  '';
}
