{ installerHelper, self, lib, ... }:

{
  name = "nixpi-installer-smoke";
  node.pkgsReadOnly = false;

  nodes.installer =
    { modulesPath, pkgs, ... }:
    let
      targetDisk = "/tmp/shared/nixpi-installer-target.qcow2";
    in
    {
      imports = [
        "${modulesPath}/installer/cd-dvd/installation-cd-minimal.nix"
      ];

      system.stateVersion = "25.05";
      networking.hostName = "nixpi-installer-test";
      networking.networkmanager.enable = true;
      services.getty.autologinUser = "nixos";
      users.users.root.initialHashedPassword = lib.mkForce null;

      virtualisation.diskImage = null;
      virtualisation.memorySize = 6144;
      virtualisation.cores = 2;
      virtualisation.graphics = false;
      virtualisation.useEFIBoot = true;
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

      environment.systemPackages = [
        installerHelper
        pkgs.dosfstools
        pkgs.jq
        pkgs.parted
      ];

      system.extraDependencies = [
        self.checks.x86_64-linux.installer-generated-config
      ];
    };

  testScript = ''
    import os
    import shlex
    import subprocess

    installer = machines[0]
    target_disk_image = "/tmp/shared/nixpi-installer-target.qcow2"
    target_mount = "/mnt"
    qemu_img = "qemu-img"

    os.makedirs(os.path.dirname(target_disk_image), exist_ok=True)
    if os.path.exists(target_disk_image):
        os.unlink(target_disk_image)
    subprocess.run([qemu_img, "create", "-f", "qcow2", target_disk_image, "20G"], check=True)

    installer.start()
    installer.wait_for_unit("multi-user.target", timeout=300)
    installer.wait_until_succeeds(
        "lsblk -dnbo NAME,SIZE,TYPE,RO | awk '$3 == \"disk\" && $4 == 0 && $2 == 21474836480 { found = 1 } END { exit found ? 0 : 1 }'",
        timeout=120,
    )

    target_disk_device = installer.succeed(
        "lsblk -dnbpo NAME,SIZE,TYPE,RO | awk '$3 == \"disk\" && $4 == 0 && $2 == 21474836480 { print $1; exit }'"
    ).strip()
    assert target_disk_device, "failed to resolve target disk device"

    def run_install_case(name, hostname, layout_args, expect_swap):
        installer.succeed("rm -f /tmp/nixpi-installer.log /tmp/nixpi-installer-artifacts.json")
        installer.succeed(
            "bash -lc "
            + shlex.quote(
                "nixpi-installer --disk "
                + target_disk_device
                + " --hostname "
                + hostname
                + " --primary-user installer "
                + " --password installerpass123 "
                + layout_args
                + " --yes --system "
                + shlex.quote("${self.checks.x86_64-linux.installer-generated-config}")
                + " > /tmp/nixpi-installer.log 2>&1 || { cat /tmp/nixpi-installer.log >&2; exit 1; }"
            )
        )
        installer.wait_until_succeeds("test -f /tmp/nixpi-installer-artifacts.json", timeout=60)
        installer.succeed("cat /tmp/nixpi-installer-artifacts.json | jq -e '.configuration_install_ref == \"" + target_mount + "/etc/nixos/configuration.nix\"'")

        installer.succeed("test -f " + target_mount + "/etc/nixos/configuration.nix")
        installer.succeed("test -f " + target_mount + "/etc/nixos/hardware-configuration.nix")
        installer.succeed("test -f " + target_mount + "/etc/nixos/nixpi-install.nix")
        installer.succeed("grep -q './hardware-configuration.nix' " + target_mount + "/etc/nixos/configuration.nix")
        installer.succeed("grep -q 'fileSystems\\.\"/\"' " + target_mount + "/etc/nixos/hardware-configuration.nix")
        installer.succeed(
            "nix-instantiate '<nixpkgs/nixos>' "
            + "-A config.system.build.toplevel "
            + "-I nixos-config="
            + target_mount
            + "/etc/nixos/configuration.nix >/tmp/nixpi-installer-eval.out"
        )
        installer.succeed("grep -q 'desktop-xfce.nix' " + target_mount + "/etc/nixos/nixpi-install.nix")
        installer.succeed("grep -q 'nixpi.primaryUser = \"installer\";' " + target_mount + "/etc/nixos/nixpi-install.nix")
        installer.succeed("grep -q 'nixpi.security.ssh.passwordAuthentication = true;' " + target_mount + "/etc/nixos/nixpi-install.nix")
        installer.fail("grep -q 'nixpi.install.mode = ' " + target_mount + "/etc/nixos/nixpi-install.nix")
        installer.fail("grep -q 'nixpi.createPrimaryUser = ' " + target_mount + "/etc/nixos/nixpi-install.nix")
        installer.fail("grep -q 'bootstrap-upgrade.nix' " + target_mount + "/etc/nixos/nixpi-install.nix")
        installer.succeed("grep -q 'imports = \\[' " + target_mount + "/etc/nixos/configuration.nix")
        installer.succeed("grep -q './nixpi-install.nix' " + target_mount + "/etc/nixos/configuration.nix")
        installer.succeed("grep -q 'networking.hostName = \"" + hostname + "\";' " + target_mount + "/etc/nixos/configuration.nix")
        installer.succeed("grep -q 'users.users.\"installer\".hashedPassword = ' " + target_mount + "/etc/nixos/nixpi-install.nix")
        installer.fail("grep -q 'users.users.\"installer\".initialPassword = ' " + target_mount + "/etc/nixos/nixpi-install.nix")
        installer.fail("test -e " + target_mount + "/etc/nixos/nixpi")
        installer.fail("test -e " + target_mount + "/etc/nixos/nixpkgs")
        installer.fail("test -e " + target_mount + "/etc/nixos/flake.nix")

        if expect_swap:
            installer.succeed("lsblk -nrpo LABEL " + target_disk_device + " | grep -qx swap")
        else:
            installer.fail("lsblk -nrpo LABEL " + target_disk_device + " | grep -qx swap")

        installer.succeed("nixos-enter --root " + target_mount + " -c 'getent passwd installer'")
        installer.succeed("nixos-enter --root " + target_mount + " -c 'command -v nixpi-bootstrap'")
        installer.succeed("nixos-enter --root " + target_mount + " -c 'command -v nixpi-finalize'")
        installer.succeed("nixos-enter --root " + target_mount + " -c 'command -v nixpi-bootstrap-ensure-repo-target'")
        installer.succeed("nixos-enter --root " + target_mount + " -c 'command -v nixpi-bootstrap-prepare-repo'")
        installer.succeed("nixos-enter --root " + target_mount + " -c 'command -v nixpi-bootstrap-nixos-rebuild-switch'")
        installer.fail("nixos-enter --root " + target_mount + " -c 'test -e /etc/nixos/flake.nix'")
        installer.fail("nixos-enter --root " + target_mount + " -c 'getent passwd agent'")

    run_install_case("no-swap", "installer-vm-noswap", "--layout no-swap", False)
    run_install_case("swap", "installer-vm-swap", "--layout swap --swap-size 8GiB", True)
  '';
}
