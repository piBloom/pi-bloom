{ pkgs, lib, piAgent, appPackage, self, installerHelper ? null, setupPackage }:

let
  testLib = import ./lib.nix { inherit pkgs lib self; };

  # self is forwarded independently (not from testLib) so test node modules
  # can reference self.nixosModules.* via _module.args.
  sharedArgs = {
    inherit piAgent appPackage setupPackage self;
    inherit (testLib)
      nixPiModules
      nixPiModulesNoShell
      mkTestFilesystems
      mkMatrixAdminSeedConfig
      matrixTestClient
      matrixRegisterScript
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
    nixpi-matrix               = runTest ./nixpi-matrix.nix;
    nixpi-firstboot            = runTest ./nixpi-firstboot.nix;
    nixpi-network              = runTest ./nixpi-network.nix;
    nixpi-daemon               = runTest ./nixpi-daemon.nix;
    nixpi-e2e                  = runTest ./nixpi-e2e.nix;
    nixpi-home                 = runTest ./nixpi-home.nix;
    nixpi-desktop              = runTest ./nixpi-desktop.nix;
    nixpi-security             = runTest ./nixpi-security.nix;
    nixpi-modular-services     = runTest ./nixpi-modular-services.nix;
    nixpi-matrix-bridge        = runTest ./nixpi-matrix-bridge.nix;
    nixpi-matrix-reply         = runTest ./nixpi-matrix-reply.nix;
    nixpi-bootstrap-mode       = runTest ./nixpi-bootstrap-mode.nix;
    nixpi-post-setup-lockdown  = runTest ./nixpi-post-setup-lockdown.nix;
    nixpi-broker               = runTest ./nixpi-broker.nix;
    nixpi-installer-smoke      = runInstallerTest ./nixpi-installer-smoke.nix;
    nixpi-update               = runTest ./nixpi-update.nix;
    nixpi-options-validation   = runTest ./nixpi-options-validation.nix;
  };

  smokeAliases = {
    smoke-matrix    = tests.nixpi-matrix;
    smoke-firstboot = tests.nixpi-firstboot;
    smoke-security  = tests.nixpi-security;
    smoke-broker    = tests.nixpi-broker;
    smoke-desktop   = tests.nixpi-desktop;
    installer-smoke = tests.nixpi-installer-smoke;
  };
in
tests // smokeAliases
