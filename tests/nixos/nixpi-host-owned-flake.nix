{ lib, nixPiModulesNoShell, piAgent, appPackage, setupApplyPackage, mkTestFilesystems, mkManagedUserConfig, ... }:

{
  name = "nixpi-host-owned-flake";

  nodes.machine =
    { ... }:
    {
      imports = nixPiModulesNoShell ++ [
        ../../core/os/modules/firstboot
        mkTestFilesystems
      ];
      _module.args = { inherit piAgent appPackage setupApplyPackage; };

      networking.hostName = "host-owned-test";
      system.stateVersion = "25.05";

      environment.etc."host-owned-marker".text = "preserved";

    }
    // (mkManagedUserConfig { username = "pi"; });

  testScript = ''
    machine = machines[0]

    machine.start()
    machine.wait_for_unit("multi-user.target", timeout=300)

    machine.succeed("test -f /etc/host-owned-marker")
    machine.succeed("grep -q 'preserved' /etc/host-owned-marker")
    machine.succeed("nixpi-bootstrap write-host-nix host-owned-test pi UTC us")
    machine.succeed("test -f /etc/nixos/flake.nix")
    machine.succeed("test -f /etc/nixos/nixpi-integration.nix")
    machine.succeed("grep -q 'host-owned-test' /etc/nixos/nixpi-host.nix")
    machine.succeed("test -f /etc/host-owned-marker")
    machine.succeed("grep -q 'preserved' /etc/host-owned-marker")

    print("nixpi-host-owned-flake test passed!")
  '';
}
