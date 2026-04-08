{
  pkgs,
  lib,
  self,
}:

let
  testLib = import ./lib.nix { inherit pkgs lib self; };

  sharedArgs = {
    inherit (testLib)
      nixPiModules
      nixPiModulesNoShell
      mkTestFilesystems
      mkManagedUserConfig
      ;
    bootstrapPackage = self.packages.${pkgs.system}.nixpi-bootstrap-vps;
  };

  runTest =
    testFile:
    pkgs.testers.runNixOSTest {
      imports = [ testFile ];
      _module.args = sharedArgs;
      defaults = testLib.mkBaseNode {
        _module.args = sharedArgs;
      };
    };

  tests = {
    nixpi-bootstrap-fresh-install = runTest ./nixpi-bootstrap-fresh-install.nix;
    nixpi-bootstrap-fresh-install-stable = runTest ./nixpi-bootstrap-fresh-install-stable.nix;
    nixpi-bootstrap-fresh-install-external = runTest ./nixpi-bootstrap-fresh-install-external.nix;
    nixpi-firstboot = runTest ./nixpi-firstboot.nix;
    nixpi-system-flake = runTest ./nixpi-system-flake.nix;
    nixpi-vps-bootstrap = runTest ./nixpi-vps-bootstrap.nix;
    nixpi-terminal = runTest ./nixpi-chat.nix;
    nixpi-network = runTest ./nixpi-network.nix;
    nixpi-e2e = runTest ./nixpi-e2e.nix;
    nixpi-security = runTest ./nixpi-security.nix;
    nixpi-wireguard = runTest ./nixpi-wireguard.nix;
    nixpi-modular-services = runTest ./nixpi-modular-services.nix;
    nixpi-post-setup-lockdown = runTest ./nixpi-post-setup-lockdown.nix;
    nixpi-broker = runTest ./nixpi-broker.nix;
    nixpi-update = runTest ./nixpi-update.nix;
    nixpi-options-validation = runTest ./nixpi-options-validation.nix;
  };

  smokeAliases = {
    smoke-firstboot = tests.nixpi-vps-bootstrap;
    smoke-terminal = tests.nixpi-terminal;
    smoke-security = tests.nixpi-security;
    smoke-broker = tests.nixpi-broker;
  };
in
tests // smokeAliases
