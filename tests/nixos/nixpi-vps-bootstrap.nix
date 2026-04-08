{ mkTestFilesystems, ... }:

{
  name = "nixpi-vps-bootstrap";

  nodes.nixpi =
    { pkgs, ... }:
    {
      imports = [
        ../../core/os/hosts/vps.nix
        mkTestFilesystems
      ];

      nixpi.primaryUser = "pi";

      virtualisation.diskSize = 20480;
      virtualisation.memorySize = 4096;
      networking.hostName = "nixpi-vps-bootstrap";

      environment.systemPackages = [ pkgs.curl ];
    };

  testScript = ''
    nixpi = machines[0]
    home = "/home/pi"

    nixpi.start()
    nixpi.wait_for_unit("multi-user.target", timeout=300)
    nixpi.wait_for_unit("nixpi-ttyd.service", timeout=120)
    nixpi.wait_for_unit("nginx.service", timeout=120)

    nixpi.wait_until_succeeds("curl -sf http://127.0.0.1/ >/dev/null", timeout=60)

    nixpi.succeed("test -d " + home + "/.pi")
    nixpi.succeed("systemctl is-enabled nixpi-ttyd.service")
    nixpi.succeed("grep -Eq '(^| )console=tty0($| )' /run/current-system/kernel-params")
    nixpi.succeed("grep -Eq '(^| )console=ttyS0,115200($| )' /run/current-system/kernel-params")
    nixpi.succeed("test \"$(systemctl is-enabled getty@tty1.service 2>&1 || true)\" = linked")
    nixpi.wait_until_succeeds("test ! -f " + home + "/.nixpi/wizard-state/system-ready", timeout=60)

    print("nixpi-vps-bootstrap tests passed!")
  '';
}
