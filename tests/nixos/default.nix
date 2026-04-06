{
  pkgs,
  lib,
  piAgent,
  appPackage,
  self,
  setupApplyPackage ? null,
}:

let
  testLib = import ./lib.nix { inherit pkgs lib self; };

  # self is forwarded independently (not from testLib) so test node modules
  # can reference self.nixosModules.* via _module.args.
  sharedArgs = {
    inherit
      piAgent
      appPackage
      self
      setupApplyPackage
      ;
    inherit (testLib)
      nixPiModules
      nixPiModulesNoShell
      mkTestFilesystems
      mkManagedUserConfig
      ;
  };

  runTest =
    testFile:
    pkgs.testers.runNixOSTest {
      imports = [ testFile ];
      _module.args = sharedArgs;
    };

  tests = {
    nixpi-firstboot = runTest ./nixpi-firstboot.nix;
    nixpi-host-owned-flake = runTest ./nixpi-host-owned-flake.nix;
    nixpi-vps-bootstrap = runTest ./nixpi-vps-bootstrap.nix;
    nixpi-chat = runTest ./nixpi-chat.nix;
    nixpi-network = runTest ./nixpi-network.nix;
    nixpi-e2e = runTest ./nixpi-e2e.nix;
    nixpi-security = runTest ./nixpi-security.nix;
    nixpi-modular-services = runTest ./nixpi-modular-services.nix;
    nixpi-bootstrap-mode = runTest ./nixpi-bootstrap-mode.nix;
    nixpi-post-setup-lockdown = runTest ./nixpi-post-setup-lockdown.nix;
    nixpi-broker = runTest ./nixpi-broker.nix;
    nixpi-update = runTest ./nixpi-update.nix;
    nixpi-options-validation = runTest ./nixpi-options-validation.nix;
  };

  smokeAliases = {
    smoke-firstboot = tests.nixpi-vps-bootstrap;
    smoke-chat = tests.nixpi-chat;
    smoke-security = tests.nixpi-security;
    smoke-broker = tests.nixpi-broker;
  };
in
tests // smokeAliases
