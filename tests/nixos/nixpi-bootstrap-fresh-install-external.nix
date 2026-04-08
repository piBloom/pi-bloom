{
  pkgs,
  bootstrapPackage,
  mkTestFilesystems,
  ...
}:

let
  rawSource = builtins.path {
    path = ../..;
    name = "source";
  };

  bootstrapSource = pkgs.runCommandLocal "nixpi-bootstrap-test-repo.git" { nativeBuildInputs = [ pkgs.git ]; } ''
    cp -R ${rawSource}/. source
    chmod -R u+w source
    rm -rf source/.git

    git -C source init --initial-branch=main
    git -C source config user.name "NixPI Test"
    git -C source config user.email "nixpi-tests@example.com"
    git -C source add .
    git -C source add -f package-lock.json
    git -C source add -f core/os/pkgs/pi/package-lock.json
    git -C source commit -m "bootstrap fixture"

    git clone --bare source "$out"
  '';

  nixosRebuildShim = pkgs.writeShellScript "nixos-rebuild" ''
    set -euo pipefail

    printf '%s\n' "$@" > /tmp/nixos-rebuild.args
    if [ "$#" -ne 4 ] || [ "$1" != "switch" ] || [ "$2" != "--flake" ] || [ "$3" != "/etc/nixos#nixos" ] || [ "$4" != "--impure" ]; then
      echo "unexpected nixos-rebuild invocation: $*" >&2
      exit 1
    fi

    ${pkgs.nix}/bin/nix --extra-experimental-features 'nix-command flakes' flake lock /etc/nixos
    ${pkgs.nix}/bin/nix --extra-experimental-features 'nix-command flakes' eval --raw --impure \
      /etc/nixos#nixosConfigurations.nixos.config.system.build.toplevel > /tmp/nixos-rebuild.outPath
    ${pkgs.nix}/bin/nix --extra-experimental-features 'nix-command flakes' eval --raw --impure \
      /etc/nixos#nixosConfigurations.nixos.config.system.build.toplevel.drvPath > /tmp/nixos-rebuild.drvPath
    printf 'ready\n' > /tmp/nixos-rebuild.ready

    while [ ! -f /tmp/nixos-rebuild.continue ]; do
      sleep 1
    done

    exec /run/current-system/sw/bin/nixos-rebuild "$@"
  '';
in
{
  name = "nixpi-bootstrap-fresh-install-external";

  nodes.nixos =
    _
    :
    {
      imports = [
        mkTestFilesystems
      ];

      networking.hostName = "bootstrap-fresh";
      environment.etc."nixos/configuration.nix".text = ''
        { ... }:
        {
          networking.hostName = "bootstrap-fresh";
          system.stateVersion = "25.05";
          boot.loader.systemd-boot.enable = true;
          boot.loader.efi.canTouchEfiVariables = true;
        }
      '';
      environment.etc."nixos/hardware-configuration.nix".text = ''
        { ... }:
        {
          fileSystems."/" = {
            device = "/dev/vda";
            fsType = "ext4";
          };

          fileSystems."/boot" = {
            device = "/dev/vda1";
            fsType = "vfat";
          };
        }
      '';

      users.users.pi = {
        isNormalUser = true;
        group = "pi";
        extraGroups = [
          "wheel"
          "networkmanager"
        ];
        home = "/home/pi";
        shell = pkgs.bash;
      };
      users.groups.pi = { };
    };

  testScript = ''
    machine = machines[0]
    bootstrap = "${bootstrapPackage}/bin/nixpi-bootstrap-vps"
    repo_url = "${bootstrapSource}"
    nixpkgs_url = "path:${pkgs.path}"
    rebuild_shim = "${nixosRebuildShim}"
    nix_bin = "${pkgs.nix}/bin/nix"
    nix_store_bin = "${pkgs.nix}/bin/nix-store"
    home = "/home/pi"

    import os
    import subprocess
    import tempfile

    machine.start()
    machine.wait_for_unit("multi-user.target", timeout=300)
    machine.succeed("test ! -e /srv/nixpi")
    machine.succeed("test -f /etc/nixos/configuration.nix")
    machine.succeed("test -f /etc/nixos/hardware-configuration.nix")
    machine.copy_from_host(rebuild_shim, "/tmp/tools/nixos-rebuild")
    machine.succeed("chmod +x /tmp/tools/nixos-rebuild")

    machine.succeed(
        "env "
        + "PATH=/tmp/tools:/run/current-system/sw/bin:/nix/var/nix/profiles/default/bin:$PATH "
        + "NIXPI_REPO_URL=" + repo_url + " "
        + "NIXPI_REPO_BRANCH=main "
        + "NIXPI_NIXPKGS_FLAKE_URL=" + nixpkgs_url + " "
        + "NIXPI_PRIMARY_USER=pi "
        + "NIXPI_HOSTNAME=bootstrap-fresh "
        + "bash -lc '"
        + bootstrap
        + " > /tmp/bootstrap.out 2>&1; echo $? > /tmp/bootstrap.exit' >/dev/null 2>&1 &"
    )

    machine.wait_until_succeeds("test -f /tmp/nixos-rebuild.ready", timeout=180)
    machine.succeed("test \"$(paste -sd ' ' /tmp/nixos-rebuild.args)\" = 'switch --flake /etc/nixos#nixos --impure'")
    requested_outpath = machine.succeed("cat /tmp/nixos-rebuild.outPath").strip()
    print("guest requested outpath:", requested_outpath)

    machine.succeed("tar -h -C /etc -czf /tmp/etc-nixos.tgz nixos")
    machine.succeed("tar -h -C /srv -czf /tmp/srv-nixpi.tgz nixpi")
    machine.copy_from_vm("/tmp/etc-nixos.tgz", "bootstrap-fixture")
    machine.copy_from_vm("/tmp/srv-nixpi.tgz", "bootstrap-fixture")

    host_fixture_dir = os.path.join(str(driver.out_dir), "bootstrap-fixture")
    host_nixos_tar = os.path.join(host_fixture_dir, "etc-nixos.tgz")
    host_repo_tar = os.path.join(host_fixture_dir, "srv-nixpi.tgz")

    temp_root = tempfile.mkdtemp(prefix="nixpi-bootstrap-build-")
    temp_nixos_dir = os.path.join(temp_root, "nixos")
    temp_repo_dir = os.path.join(temp_root, "nixpi")
    host_home = os.path.join(temp_root, "home")
    host_state = os.path.join(temp_root, "state")
    os.makedirs(temp_nixos_dir)
    os.makedirs(temp_repo_dir)
    os.makedirs(host_home)
    os.makedirs(host_state)
    subprocess.run(["tar", "-xzf", host_nixos_tar, "-C", temp_root], check=True)
    subprocess.run(["tar", "-xzf", host_repo_tar, "-C", temp_root], check=True)
    subprocess.run(["chmod", "-R", "u+w", temp_root], check=True)

    host_env = os.environ.copy()
    host_env["HOME"] = host_home
    host_env["XDG_STATE_HOME"] = host_state

    def host_run(args):
        result = subprocess.run(args, capture_output=True, text=True, env=host_env)
        if result.returncode != 0:
            raise AssertionError(
                "host command failed:\nCMD: "
                + " ".join(args)
                + "\nSTDOUT:\n"
                + result.stdout
                + "\nSTDERR:\n"
                + result.stderr
            )
        return result.stdout.strip()

    host_build = host_run(
        [
            nix_bin,
            "--extra-experimental-features",
            "nix-command flakes",
            "build",
            "--no-link",
            "--print-out-paths",
            temp_nixos_dir + "#nixosConfigurations.nixos.config.system.build.toplevel",
            "--override-input",
            "nixpi",
            "path:" + temp_repo_dir,
            "--impure",
        ]
    )
    print("host built outpath:", host_build)
    assert host_build == requested_outpath, f"host closure {host_build} != guest requested {requested_outpath}"

    host_drv = host_run(
        [
            nix_bin,
            "--extra-experimental-features",
            "nix-command flakes",
            "eval",
            "--raw",
            temp_nixos_dir + "#nixosConfigurations.nixos.config.system.build.toplevel.drvPath",
            "--override-input",
            "nixpi",
            "path:" + temp_repo_dir,
            "--impure",
        ]
    )

    requisites = host_run([ nix_store_bin, "-qR", host_build, host_drv ]).splitlines()

    closure_path = os.path.join(temp_root, "closure.nar")
    with open(closure_path, "wb") as fh:
        subprocess.run([nix_store_bin, "--export", host_drv, host_build, *requisites], check=True, stdout=fh)

    machine.copy_from_host(closure_path, "/tmp/shared/prebuilt-closure.nar")
    machine.succeed("nix-store --import < /tmp/shared/prebuilt-closure.nar")
    machine.succeed("test -e " + requested_outpath)
    machine.succeed("touch /tmp/nixos-rebuild.continue")

    machine.wait_until_succeeds("test -f /tmp/bootstrap.exit", timeout=300)
    machine.succeed("test \"$(cat /tmp/bootstrap.exit)\" = 0")

    machine.wait_for_unit("nixpi-ttyd.service", timeout=180)
    machine.wait_for_unit("nixpi-ttyd.service", timeout=180)
    machine.wait_for_unit("nginx.service", timeout=180)
    machine.succeed("command -v nixpi-rebuild")
    machine.succeed("test -d " + home + "/.pi")
    machine.succeed("test ! -L " + home + "/.pi")
    machine.wait_until_succeeds("curl -sf http://127.0.0.1/ | grep -q 'nixpi-shell'", timeout=60)
    machine.wait_until_succeeds("curl -sf http://127.0.0.1/ >/dev/null", timeout=60)
    machine.succeed("grep -q \"Bootstrap complete. Use 'nixpi-rebuild'\" /tmp/bootstrap.out")

    print("nixpi-bootstrap-fresh-install-external test passed!")
  '';
}
