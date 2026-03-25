{ nixPiModules, piAgent, appPackage, setupPackage, ... }:

{
  name = "nixpi-desktop";

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
    networking.hostName = "nixpi-desktop-test";

    virtualisation.diskSize = 20480;
    virtualisation.memorySize = 4096;
    virtualisation.graphics = true;
  };

  testScript = ''
    nixpi = machines[0]

    nixpi.start()
    nixpi.wait_for_unit("display-manager.service", timeout=300)
    nixpi.wait_until_succeeds("systemctl is-active display-manager.service", timeout=120)
    nixpi.wait_until_succeeds("loginctl list-sessions --no-legend | grep -q ' pi '", timeout=120)
    nixpi.wait_until_succeeds("journalctl -u display-manager --no-pager | grep -q 'session opened for user pi'", timeout=120)
    nixpi.wait_until_succeeds("test -f /home/pi/.Xauthority", timeout=120)

    nixpi.succeed("command -v thunar")
    nixpi.succeed("command -v xfce4-panel")
    nixpi.succeed("command -v xdotool")
    nixpi.succeed("command -v wmctrl")
    nixpi.succeed("command -v scrot")
    nixpi.succeed("command -v tesseract")
    nixpi.succeed("runuser -u pi -- env DISPLAY=:0 XAUTHORITY=/home/pi/.Xauthority setxkbmap -query | grep -q 'layout:[[:space:]]*us'")

    nixpi.succeed(
        "runuser -u pi -- /bin/sh -lc "
        + "\"DISPLAY=:0 XAUTHORITY=/home/pi/.Xauthority "
        + "xterm -title ShiftProbe -e /bin/sh -lc 'cat > /tmp/shift-probe.txt' "
        + ">/tmp/shift-probe.log 2>&1 &\""
    )
    nixpi.wait_until_succeeds(
        "runuser -u pi -- env DISPLAY=:0 XAUTHORITY=/home/pi/.Xauthority wmctrl -l | grep -q ShiftProbe",
        timeout=120,
    )
    nixpi.succeed(
        "runuser -u pi -- /bin/sh -lc "
        + "\"export DISPLAY=:0 XAUTHORITY=/home/pi/.Xauthority; "
        + "wmctrl -a ShiftProbe; "
        + "sleep 1; "
        + "xdotool type a; "
        + "xdotool key Shift_L+a; "
        + "xdotool key Return; "
        + "xdotool key ctrl+d\""
    )
    nixpi.wait_until_succeeds("test -f /tmp/shift-probe.txt", timeout=60)
    nixpi.succeed("tr -d '\\n' < /tmp/shift-probe.txt | grep -qx 'aA'")
  '';
}
