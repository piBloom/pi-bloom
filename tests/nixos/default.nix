{ pkgs, lib, piAgent, appPackage, self, installerHelper ? null, setupPackage }:

let
  testLib = import ./lib.nix { inherit pkgs lib self; };

  inherit (testLib)
    nixPiModules
    nixPiModulesNoShell
    mkTestFilesystems
    mkMatrixAdminSeedConfig
    matrixTestClient
    matrixRegisterScript
    mkManagedUserConfig
    mkPrefillActivation;

  mkTest = testFile: import testFile {
    inherit
      pkgs
      lib
      nixPiModules
      nixPiModulesNoShell
      piAgent
      appPackage
      setupPackage
      mkTestFilesystems
      mkMatrixAdminSeedConfig
      matrixTestClient
      matrixRegisterScript
      mkManagedUserConfig
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
      setupPackage
      mkTestFilesystems
      mkMatrixAdminSeedConfig
      matrixTestClient
      matrixRegisterScript
      mkManagedUserConfig
      mkPrefillActivation
      self
      installerHelper;
  };

  tests = {
    nixpi-matrix = mkTest ./nixpi-matrix.nix;
    nixpi-firstboot = mkTest ./nixpi-firstboot.nix;
    nixpi-network = mkTest ./nixpi-network.nix;
    nixpi-daemon = mkTest ./nixpi-daemon.nix;
    nixpi-e2e = mkTest ./nixpi-e2e.nix;
    nixpi-home = mkTest ./nixpi-home.nix;
    nixpi-desktop = mkTest ./nixpi-desktop.nix;
    nixpi-security = mkTest ./nixpi-security.nix;
    nixpi-modular-services = mkTest ./nixpi-modular-services.nix;
    nixpi-matrix-bridge = mkTest ./nixpi-matrix-bridge.nix;
    nixpi-matrix-reply = mkTest ./nixpi-matrix-reply.nix;
    nixpi-bootstrap-mode = mkTest ./nixpi-bootstrap-mode.nix;
    nixpi-post-setup-lockdown = mkTest ./nixpi-post-setup-lockdown.nix;
    nixpi-broker = mkTest ./nixpi-broker.nix;
    nixpi-installer-smoke = mkInstallerTest ./nixpi-installer-smoke.nix;
  };

  smokeAliases = {
    smoke-matrix = tests.nixpi-matrix;
    smoke-firstboot = tests.nixpi-firstboot;
    smoke-security = tests.nixpi-security;
    smoke-broker = tests.nixpi-broker;
    smoke-desktop = tests.nixpi-desktop;
    installer-smoke = tests.nixpi-installer-smoke;
  };
in
tests // smokeAliases
