{
  mkTestFilesystems,
  ...
}:

let
  username = "pi";
  homeDir = "/home/${username}";
in
{
  name = "nixpi-firstboot";

  nodes.nixpi = {
    ...
  }: {
    imports = [
      ../../core/os/hosts/vps.nix
      mkTestFilesystems
    ];

    networking.hostName = "nixpi-firstboot-test";
    nixpi = {
      primaryUser = username;
      bootstrap.enable = true;
    };

    systemd.tmpfiles.rules = [ "d ${homeDir}/.nixpi 0755 ${username} ${username} -" ];
  };

  testScript = ''
    nixpi = machines[0]
    home = "/home/pi"

    nixpi.start()
    nixpi.wait_for_unit("multi-user.target", timeout=300)
    nixpi.wait_until_succeeds("ip -4 addr show dev eth1 | grep -q 'inet '", timeout=60)
    nixpi.wait_for_unit("wireguard-wg0.service", timeout=60)
    nixpi.wait_for_unit("nixpi-app-setup.service", timeout=120)
    nixpi.wait_for_unit("sshd.service", timeout=60)
    nixpi.succeed("hostnamectl --static | grep -qx 'nixpi-firstboot-test'")
    nixpi.succeed("test -d " + home + "/.nixpi")
    nixpi.fail("test -f " + home + "/.nixpi/.setup-complete")
    nixpi.succeed("sudo -u pi -- sudo -n true")
    nixpi.succeed("ss -ltn '( sport = :22 )' | grep -q LISTEN")
    nixpi.fail("command -v nixpi-setup-apply")

    nixpi.succeed("test -d " + home + "/.pi")
    nixpi.succeed("test -d " + home + "/.pi/agent")
    nixpi.succeed("test ! -L " + home + "/.pi")
    nixpi.succeed("test \"$(stat -c %U " + home + "/.pi)\" = pi")
    nixpi.succeed("test -L " + home + "/.pi/settings.json")
    nixpi.succeed("readlink " + home + "/.pi/settings.json | grep -q '^/nix/store/'")
    nixpi.fail("test -e " + home + "/.pi/agent/auth.json")
    nixpi.fail("test -L " + home + "/.pi/agent/auth.json")
    nixpi.fail("systemctl cat nixpi-app-setup.service | grep -Eq 'chown -R|install -m 0600'")
    nixpi.fail("test -e /srv/nixpi")
    nixpi.fail("test -f /etc/nixos/flake.nix")
    nixpi.fail("systemctl cat nixpi-install-finalize.service >/dev/null")
    nixpi.fail("command -v codex")
    nixpi.fail("test -e " + home + "/.bashrc")
    nixpi.fail("test -e " + home + "/.bash_profile")
    nixpi.fail("test -e /etc/skel/.bashrc")
    nixpi.fail("test -e /etc/skel/.bash_profile")
    nixpi.fail("grep -q 'nixpi-shell-dotfiles' /run/current-system/activate")
    nixpi.succeed(
        "sudo -u pi -- bash -lc '"
        + "test \"$NIXPI_PI_DIR\" = /home/pi/.pi && "
        + "test \"$PI_CODING_AGENT_DIR\" = /home/pi/.pi && "
        + "printf %s \"$PATH\" | grep -q \"/usr/local/share/nixpi/node_modules/.bin\" && "
        + "pi --help | grep -q \"AI coding assistant\"'"
    )

    print("All nixpi-firstboot tests passed!")
  '';
}
