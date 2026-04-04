{ pkgs, lib, piAgent, appPackage, self, installerHelper ? null }:

let
  testLib = import ./lib.nix { inherit pkgs lib self; };

  # self is forwarded independently (not from testLib) so test node modules
  # can reference self.nixosModules.* via _module.args.
  sharedArgs = {
    inherit piAgent appPackage self;
    inherit (testLib)
      nixPiModules
      nixPiModulesNoShell
      mkTestFilesystems
      mkManagedUserConfig
      mkPrefillActivation;
  };

  runTest = testFile: pkgs.testers.runNixOSTest {
    imports = [ testFile ];
    _module.args = sharedArgs;
  };

  runInstallerTest = testFile: pkgs.testers.runNixOSTest {
    imports = [ testFile ];
    _module.args = sharedArgs // { inherit installerHelper; };
  };

  tests = {
    nixpi-firstboot            = runTest ./nixpi-firstboot.nix;
    nixpi-chat                 = runTest ./nixpi-chat.nix;
    nixpi-network              = runTest ./nixpi-network.nix;
    nixpi-e2e                  = runTest ./nixpi-e2e.nix;
    nixpi-rdp                  = runTest ./nixpi-rdp.nix;
    nixpi-security             = runTest ./nixpi-security.nix;
    nixpi-modular-services     = runTest ./nixpi-modular-services.nix;
    nixpi-bootstrap-mode       = runTest ./nixpi-bootstrap-mode.nix;
    nixpi-post-setup-lockdown  = runTest ./nixpi-post-setup-lockdown.nix;
    nixpi-broker               = runTest ./nixpi-broker.nix;
    nixpi-installer-smoke      = runInstallerTest ./nixpi-installer-smoke.nix;
    nixpi-update               = runTest ./nixpi-update.nix;
    nixpi-options-validation   = runTest ./nixpi-options-validation.nix;
  };

  smokeAliases = {
    smoke-firstboot        = tests.nixpi-firstboot;
    smoke-chat            = tests.nixpi-chat;
    smoke-security  = tests.nixpi-security;
    smoke-broker    = tests.nixpi-broker;
    installer-smoke = tests.nixpi-installer-smoke;
  };
in
tests // smokeAliases
