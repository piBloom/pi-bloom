{ pkgs, lib, installerPkgs, ... }:

pkgs.testers.runNixOSTest {
  name = "nixpi-installer-smoke";
  enableOCR = true;

  nodes.installer =
    { ... }:
    let
      targetDisk = "/tmp/shared/nixpi-installer-target.qcow2";
      smokeCalamaresExtensions = installerPkgs.calamares-nixos-extensions.overrideAttrs (old: {
        postInstall = (old.postInstall or "") + ''
          cat > $out/etc/calamares/modules/welcome.conf <<'EOF'
          showReleaseNotesUrl: false

          requirements:
              requiredStorage: 1
              requiredRam: 3.0

              check:
                  - storage
                  - ram
                  - power
                  - screen

              required:
                  - storage
                  - ram
          EOF
        '';
      });
    in
    {
      imports = [
        "${pkgs.path}/nixos/modules/installer/cd-dvd/installation-cd-graphical-calamares-gnome.nix"
      ];

      nixpkgs.overlays = lib.mkForce [
        (_final: _prev: {
          calamares-nixos = installerPkgs.calamares-nixos;
          calamares-nixos-extensions = smokeCalamaresExtensions;
        })
      ];

      services.desktopManager.gnome.enable = lib.mkForce false;
      services.xserver.windowManager.openbox.enable = true;
      services.displayManager.gdm.enable = lib.mkForce false;
      services.xserver.displayManager.lightdm.enable = true;
      services.displayManager.defaultSession = "none+openbox";
      services.displayManager.autoLogin = {
        enable = true;
        user = "nixos";
      };

      users.users.nixos = {
        isNormalUser = true;
        extraGroups = [ "wheel" "networkmanager" ];
        password = "";
      };

      programs.partition-manager.enable = true;
      services.resolved.enable = true;
      i18n.supportedLocales = [ "all" ];
      system.stateVersion = "25.05";
      networking.hostName = "nixpi-installer-test";
      networking.networkmanager.enable = true;
      time.timeZone = "UTC";
      i18n.defaultLocale = "en_US.UTF-8";

      virtualisation.diskImage = null;
      virtualisation.memorySize = 6144;
      virtualisation.cores = 2;
      virtualisation.graphics = true;
      virtualisation.resolution = {
        x = 1440;
        y = 900;
      };
      virtualisation.qemu.drives = [
        {
          name = "target";
          file = targetDisk;
          driveExtraOpts = {
            format = "qcow2";
            cache = "writeback";
            werror = "report";
          };
          deviceExtraOpts = {
            serial = "nixpi-installer-target";
          };
        }
      ];

      environment.systemPackages = with pkgs; [
        xdotool
        wmctrl
        xwininfo
      ] ++ [
        installerPkgs.calamares-nixos
        smokeCalamaresExtensions
        pkgs.glibcLocales
      ];
    };

  testScript = ''
    import os
    import shlex
    import subprocess
    import time

    installer = machines[0]
    target_disk = "/tmp/shared/nixpi-installer-target.qcow2"
    target_mount = "/mnt/nixpi-installer-target"
    calamares_session_log = "/home/nixos/.cache/calamares/session.log"
    qemu_img = "${pkgs.qemu}/bin/qemu-img"

    os.makedirs(os.path.dirname(target_disk), exist_ok=True)
    if os.path.exists(target_disk):
        os.unlink(target_disk)
    subprocess.run([qemu_img, "create", "-f", "qcow2", target_disk, "20G"], check=True)

    def calamares_key(key, pause=0.4):
        installer.send_key(key)
        time.sleep(pause)

    def calamares_type(text, pause=0.8):
        installer.send_chars(text)
        time.sleep(pause)

    def next_page():
        calamares_key("alt-n", pause=1.0)

    def x11(command):
        installer.succeed("su - nixos -c " + shlex.quote("DISPLAY=:0 " + command))

    def user_shell(command):
        installer.succeed("su - nixos -c " + shlex.quote(command))

    installer.start()
    installer.wait_for_unit("display-manager.service", timeout=300)
    installer.wait_for_x(timeout=300)
    installer.wait_until_succeeds("nm-online -q --timeout=60", timeout=300)
    installer.succeed("ip -brief addr")
    installer.succeed("ip route")
    installer.succeed("resolvectl status")
    installer.succeed("rm -f /tmp/calamares.log")
    installer.succeed(
        "su - nixos -c " +
        shlex.quote(
            "env DISPLAY=:0 "
            "XDG_RUNTIME_DIR=/run/user/1000 "
            "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus "
            "${installerPkgs.calamares-nixos}/bin/calamares "
            ">/tmp/calamares.log 2>&1 &"
        )
    )
    installer.wait_until_succeeds("pgrep -fa '${installerPkgs.calamares-nixos}/bin/calamares'", timeout=60)
    try:
        installer.wait_until_succeeds(
            "su - nixos -c 'DISPLAY=:0 wmctrl -lx | grep -i calamares'",
            timeout=30,
        )
    except Exception:
        print(installer.succeed("sh -c 'pgrep -fa calamares || true'"))
        print(installer.succeed("sh -c 'journalctl --no-pager -b _COMM=calamares || true'"))
        print(installer.succeed("sh -c 'cat /tmp/calamares.log || true'"))
        print(installer.succeed("su - nixos -c 'sh -c \"DISPLAY=:0 wmctrl -lx || true\"'"))
        print(installer.succeed("su - nixos -c 'sh -c \"DISPLAY=:0 xwininfo -root -tree || true\"'"))
        print(user_shell("sh -c 'journalctl --user --no-pager -b | tail -n 200 || true'"))
        print(user_shell("sh -c 'cat ~/.xsession-errors 2>/dev/null || true'"))
        raise

    x11("wmctrl -lx")
    time.sleep(5.0)
    installer.screenshot("installer-welcome")

    next_page()
    time.sleep(2.0)
    next_page()
    time.sleep(2.0)
    next_page()

    time.sleep(2.0)
    calamares_key("tab")
    calamares_type("NixPI Tester\tinstaller\tinstaller-vm\tTestPass123!\tTestPass123!\tRootPass123!\tRootPass123!")
    installer.screenshot("installer-users")
    next_page()

    time.sleep(2.0)
    next_page()

    time.sleep(2.0)
    next_page()

    time.sleep(2.0)
    calamares_key("tab")
    calamares_key("spc")
    installer.screenshot("installer-partition")
    next_page()

    time.sleep(2.0)
    installer.screenshot("installer-summary")
    next_page()
    time.sleep(2.0)
    installer.screenshot("installer-confirm")
    calamares_key("alt-i", pause=2.0)
    calamares_key("ret", pause=2.0)

    installer.wait_until_succeeds("test -f " + calamares_session_log, timeout=120)
    try:
        installer.wait_until_succeeds(
            "grep -Eq 'Starting job \"nixos\"|Job added:.*nixos|exec.*nixos' " + calamares_session_log,
            timeout=60,
        )
    except Exception:
        installer.screenshot("installer-install-start-timeout")
        print(installer.succeed("cat " + calamares_session_log))
        print(installer.succeed("sh -c 'cat /tmp/calamares.log || true'"))
        print(user_shell("sh -c 'DISPLAY=:0 wmctrl -l || true'"))
        print(user_shell("sh -c 'DISPLAY=:0 xwininfo -root -tree || true'"))
        raise
    installer.wait_until_succeeds(
        "grep -q 'Installation failed' " + calamares_session_log +
        " || grep -q 'ViewModule \"finished@finished\" loading complete.' " + calamares_session_log,
        timeout=1200,
    )

    session_log = installer.succeed("cat " + calamares_session_log)
    print(session_log)
    assert "Installation failed" not in session_log, session_log
    assert "Bad main script file" not in session_log, session_log
    assert "SyntaxError: invalid syntax" not in session_log, session_log

    installer.wait_until_succeeds("lsblk -no FSTYPE /dev/disk/by-id/virtio-nixpi-installer-target | grep -q .", timeout=300)
    installer.wait_until_succeeds("blkid /dev/disk/by-id/virtio-nixpi-installer-target-part2", timeout=300)

    installer.succeed("mkdir -p " + target_mount)
    installer.succeed("mount /dev/disk/by-id/virtio-nixpi-installer-target-part2 " + target_mount)
    installer.succeed("mkdir -p " + target_mount + "/boot")
    installer.succeed("mount /dev/disk/by-id/virtio-nixpi-installer-target-part1 " + target_mount + "/boot")

    installer.succeed("test -f " + target_mount + "/etc/nixos/configuration.nix")
    installer.succeed("test -f " + target_mount + "/etc/nixos/nixpi-install.nix")
    installer.succeed("test -f " + target_mount + "/etc/nixos/nixpi-host.nix")
    installer.succeed("test -f " + target_mount + "/etc/nixos/flake.nix")
    installer.succeed("grep -q 'nixpi.primaryUser = \"installer\";' " + target_mount + "/etc/nixos/nixpi-install.nix")
    installer.succeed("grep -q 'nixosConfigurations.\"installer-vm\"' " + target_mount + "/etc/nixos/flake.nix")

    installer.screenshot("installer-finished")
  '';
}
