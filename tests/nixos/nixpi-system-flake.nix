{
  mkTestFilesystems,
  ...
}:

let
  username = "pi";
in
{
  name = "nixpi-system-flake";
  # Retained historical name; this test now proves the declarative path by
  # asserting that NixPI does not generate /etc/nixos/flake.nix at runtime.

  nodes.machine = {
    ...
  }: {
    imports = [
      ../../core/os/hosts/vps.nix
      mkTestFilesystems
    ];

    networking.hostName = "system-flake-test";
    nixpi.primaryUser = username;
    nixpi.security.ssh.allowedSourceCIDRs = [ "192.0.2.10/32" ];

    environment.etc."system-flake-marker".text = "preserved";
  };

  testScript = ''
    machine = machines[0]

    machine.start()
    machine.wait_for_unit("multi-user.target", timeout=300)
    machine.wait_for_unit("nixpi-app-setup.service", timeout=120)

    machine.succeed("hostnamectl --static | grep -qx 'system-flake-test'")
    machine.succeed("test -f /etc/system-flake-marker")
    machine.succeed("grep -q 'preserved' /etc/system-flake-marker")
    machine.succeed("test -d /home/pi/.pi")
    machine.succeed("test -f /home/pi/.pi/settings.json")
    machine.fail("test -e /srv/nixpi")
    machine.fail("test -f /etc/nixos/flake.nix")

    print("nixpi-system-flake test passed!")
  '';
}
