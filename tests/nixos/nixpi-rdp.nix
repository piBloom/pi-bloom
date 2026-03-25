{ nixPiModules, piAgent, appPackage, setupPackage, ... }:

{
  name = "nixpi-rdp";

  nodes.nixpi = { ... }: {
    imports = [
      ../../core/os/modules/firstboot
      ../../core/os/modules/desktop-xfce.nix
      {
        fileSystems."/" = { device = "/dev/vda"; fsType = "ext4"; };
        fileSystems."/boot" = { device = "/dev/vda1"; fsType = "vfat"; };
      }
    ] ++ nixPiModules;
    _module.args = { inherit piAgent appPackage setupPackage; };

    services.xserver.xkb = { layout = "us"; variant = ""; };
    console.keyMap = "us";

    nixpi.primaryUser = "pi";
    networking.hostName = "nixpi-rdp-test";

    virtualisation.diskSize = 20480;
    virtualisation.memorySize = 4096;
    virtualisation.graphics = true;
  };

  testScript = ''
    nixpi = machines[0]

    nixpi.start()
    nixpi.wait_for_unit("display-manager.service", timeout=300)
    nixpi.wait_for_unit("xrdp.service", timeout=60)
    nixpi.wait_for_unit("xrdp-sesman.service", timeout=60)

    # Verify port 3389 is listening
    nixpi.wait_until_succeeds("ss -tlnp | grep -q ':3389'", timeout=30)
  '';
}
