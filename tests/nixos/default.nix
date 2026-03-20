# tests/nixos/default.nix
# NixOS integration test suite for NixPI
#
# Usage:
#   nix build .#checks.x86_64-linux.nixpi-matrix
#   nix build .#checks.x86_64-linux.nixpi-firstboot
#   nix build .#checks.x86_64-linux.localai
#   nix build .#checks.x86_64-linux.nixpi-network
#   nix build .#checks.x86_64-linux.nixpi-daemon
#   nix build .#checks.x86_64-linux.nixpi-e2e
#   nix build .#checks.x86_64-linux.nixpi-home
#
# Or run all: nix flake check

{ pkgs, lib, piAgent, appPackage, self, installerPkgs ? pkgs }:

let
  # Import shared helpers
  testLib = import ./lib.nix { inherit pkgs lib self; };
  
  inherit (testLib)
    nixPiModules
    nixPiModulesNoShell
    mkNixPiNode
    mkTestFilesystems
    matrixTestClient
    matrixRegisterScript
    mkManagedUserConfig
    mkExistingUserConfig
    mkPrefillActivation;
  
  # Test function with common dependencies
  mkTest = testFile: import testFile {
    inherit
      pkgs
      lib
      nixPiModules
      nixPiModulesNoShell
      piAgent
      appPackage
      mkNixPiNode
      mkTestFilesystems
      matrixTestClient
      matrixRegisterScript
      mkManagedUserConfig
      mkExistingUserConfig
      mkPrefillActivation
      self;
  };

  mkInstallerTest = testFile: import testFile {
    inherit
      pkgs
      lib
      nixPiModules
      nixPiModulesNoShell
      piAgent
      appPackage
      mkNixPiNode
      mkTestFilesystems
      matrixTestClient
      matrixRegisterScript
      mkManagedUserConfig
      mkExistingUserConfig
      mkPrefillActivation
      self
      installerPkgs;
  };
in
{
  smoke-matrix = mkTest ./nixpi-matrix.nix;
  smoke-firstboot = mkTest ./nixpi-firstboot.nix;
  smoke-security = mkTest ./nixpi-security.nix;
  smoke-broker = mkTest ./nixpi-broker.nix;
  installer-smoke = mkInstallerTest ./nixpi-installer-smoke.nix;

  # Matrix homeserver test
  nixpi-matrix = mkTest ./nixpi-matrix.nix;
  
  # First-boot wizard test
  nixpi-firstboot = mkTest ./nixpi-firstboot.nix;
  
  # LocalAI inference test (with test model)
  localai = mkTest ./localai.nix;
  
  # Network connectivity test
  nixpi-network = mkTest ./nixpi-network.nix;
  
  # Pi daemon test
  nixpi-daemon = mkTest ./nixpi-daemon.nix;
  
  # End-to-end integration test
  nixpi-e2e = mkTest ./nixpi-e2e.nix;

  # NixPI Home landing page and user service test
  nixpi-home = mkTest ./nixpi-home.nix;

  # Firewall and service exposure policy test
  nixpi-security = mkTest ./nixpi-security.nix;

  # Modular service/configData regression test
  nixpi-modular-services = mkTest ./nixpi-modular-services.nix;

  # Multi-node Matrix daemon transport test
  nixpi-matrix-bridge = mkTest ./nixpi-matrix-bridge.nix;

  # No-prefill bootstrap policy test
  nixpi-bootstrap-mode = mkTest ./nixpi-bootstrap-mode.nix;

  # Post-setup security transition and persistence test
  nixpi-post-setup-lockdown = mkTest ./nixpi-post-setup-lockdown.nix;

  # Broker autonomy and privilege boundaries test
  nixpi-broker = mkTest ./nixpi-broker.nix;

  # Live installer smoke test that drives Calamares through a real install.
  nixpi-installer-smoke = mkInstallerTest ./nixpi-installer-smoke.nix;
}
