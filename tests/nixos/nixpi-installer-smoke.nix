{ pkgs, installerPkgs, ... }:

pkgs.testers.runNixOSTest {
  name = "nixpi-installer-smoke";
  enableOCR = true;

  nodes.installer =
    { ... }:
    let
      targetDisk = "/tmp/shared/nixpi-installer-target.qcow2";
      calamaresAutostart = pkgs.makeAutostartItem {
        name = "calamares";
        package = installerPkgs.calamares-nixos;
      };
    in
    {
      services.xserver.enable = true;
      services.desktopManager.gnome.enable = true;
      services.displayManager.gdm.enable = true;
      services.displayManager.gdm.wayland = false;
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
        installerPkgs.calamares-nixos-extensions
        calamaresAutostart
        pkgs.glibcLocales
      ];
    };

  testScript = ''
    import os
    import subprocess
    import time

    installer = machines[0]
    target_disk = "/tmp/shared/nixpi-installer-target.qcow2"
    target_mount = "/mnt/nixpi-installer-target"
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

    installer.start()
    installer.wait_for_unit("display-manager.service", timeout=300)
    installer.wait_for_x(timeout=300)
    installer.wait_until_succeeds("pgrep -fa calamares", timeout=300)
    installer.wait_until_succeeds("curl -Is https://cache.nixos.org >/dev/null", timeout=300)
    installer.wait_for_text("NixOS|Calamares", timeout=300)
    installer.screenshot("installer-welcome")

    next_page()
    installer.wait_for_text("Location|Timezone|Locale", timeout=120)
    next_page()
    installer.wait_for_text("Keyboard", timeout=120)
    next_page()

    installer.wait_for_text("Name|Hostname|Password", timeout=120)
    calamares_key("tab")
    calamares_type("NixPI Tester\tinstaller\tinstaller-vm\tTestPass123!\tTestPass123!\tRootPass123!\tRootPass123!")
    installer.screenshot("installer-users")
    next_page()

    installer.wait_for_text("Desktop|GNOME", timeout=120)
    next_page()

    installer.wait_for_text("unfree|proprietary|Proprietary", timeout=120)
    next_page()

    installer.wait_for_text("Erase|partition|disk", timeout=180)
    calamares_key("tab")
    calamares_key("spc")
    installer.screenshot("installer-partition")
    next_page()

    installer.wait_for_text("Summary", timeout=120)
    installer.screenshot("installer-summary")
    next_page()

    installer.wait_until_succeeds("test -f /root/.cache/calamares/session.log", timeout=120)
    installer.wait_until_succeeds("grep -q 'Starting job \"nixos\"' /root/.cache/calamares/session.log", timeout=600)
    installer.wait_until_succeeds("grep -q 'Installation failed' /root/.cache/calamares/session.log || grep -q 'ViewModule \"finished@finished\" loading complete.' /root/.cache/calamares/session.log", timeout=1200)

    session_log = installer.succeed("cat /root/.cache/calamares/session.log")
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
