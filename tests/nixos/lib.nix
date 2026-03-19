# tests/nixos/lib.nix
# Shared helpers for Workspace OS NixOS integration tests

{ pkgs, lib }:

{
  # Common test configuration for Workspace OS nodes
  mkWorkspaceNode = { workspaceModules, piAgent, appPackage, extraConfig ? {} }: {
    imports = workspaceModules ++ [ extraConfig ];
    _module.args = { inherit piAgent appPackage; };
    
    # Common VM settings for tests
    virtualisation.diskSize = 20480;  # 20 GB
    virtualisation.memorySize = 4096;
    
    # Standard Workspace configuration
    boot.loader.systemd-boot.enable = true;
    boot.loader.efi.canTouchEfiVariables = true;
    networking.hostName = lib.mkDefault "nixos";
    time.timeZone = "UTC";
    i18n.defaultLocale = "en_US.UTF-8";
    networking.networkmanager.enable = true;
    system.stateVersion = "25.05";
  };

  # Minimal filesystem configuration for test VMs
  mkTestFilesystems = {
    fileSystems."/" = { device = "/dev/vda"; fsType = "ext4"; };
    fileSystems."/boot" = { device = "/dev/vda1"; fsType = "vfat"; };
  };

  # Standard Workspace modules list
  workspaceModules = [
    ../../core/os/modules/app.nix
    ../../core/os/modules/llm.nix
    ../../core/os/modules/matrix.nix
    ../../core/os/modules/network.nix
    ../../core/os/modules/shell.nix
    ../../core/os/modules/update.nix
  ];

  # Workspace modules without workspace-shell (for tests that define their own user)
  workspaceModulesNoShell = [
    ../../core/os/modules/options.nix
    ../../core/os/modules/app.nix
    ../../core/os/modules/llm.nix
    ../../core/os/modules/matrix.nix
    ../../core/os/modules/network.nix
    ../../core/os/modules/update.nix
  ];

  # Test utilities package
  testUtils = pkgs.writeShellScriptBin "workspace-test-utils" ''
    # Wait for a systemd unit to be active on the user bus
    wait_for_user_unit() {
      local user="$1"
      local unit="$2"
      local timeout="''${3:-30}"
      local elapsed=0
      
      while ! systemctl --user -M "$user@" is-active "$unit" 2>/dev/null | grep -q active; do
        sleep 1
        elapsed=$((elapsed + 1))
        if [ "$elapsed" -ge "$timeout" ]; then
          echo "Timeout waiting for user unit $unit"
          return 1
        fi
      done
    }
    
    # Register a Matrix user on the local Conduwuity instance
    register_matrix_user() {
      local username="$1"
      local password="$2"
      local homeserver="''${3:-http://localhost:6167}"
      
      curl -sf -X POST "''${homeserver}/_matrix/client/v3/register" \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"$username\",\"password\":\"$password\",\"type\":\"m.login.dummy\"}"
    }
    
    # Get Matrix registration token from file
    get_matrix_token() {
      local token_file="/var/lib/continuwuity/registration_token"
      if [ -f "$token_file" ]; then
        cat "$token_file"
      else
        echo ""
      fi
    }
    
    # Check if Matrix homeserver is ready
    matrix_ready() {
      local homeserver="''${1:-http://localhost:6167}"
      curl -sf "''${homeserver}/_matrix/client/versions" >/dev/null 2>&1
    }
    
    # Wait for Matrix homeserver to be ready
    wait_for_matrix() {
      local homeserver="''${1:-http://localhost:6167}"
      local timeout="''${2:-60}"
      local elapsed=0
      
      while ! matrix_ready "$homeserver"; do
        sleep 1
        elapsed=$((elapsed + 1))
        if [ "$elapsed" -ge "$timeout" ]; then
          echo "Timeout waiting for Matrix homeserver"
          return 1
        fi
      done
    }
  '';
}
