{
  lib,
  nixPiModulesNoShell,
  mkTestFilesystems,
  ...
}:

let
  initSystemFlake = ../../core/scripts/nixpi-init-system-flake.sh;
  mkNode =
    {
      hostName ? "nixpi-firstboot-test",
    }:
    { pkgs, ... }:
    let
      username = "pi";
      homeDir = "/home/${username}";
    in
    {
      imports = nixPiModulesNoShell ++ [
        ../../core/os/modules/ttyd.nix
        ../../core/os/modules/service-surface.nix
        mkTestFilesystems
      ];
      nixpi.primaryUser = username;

      networking.hostName = hostName;
      users.users.${username} = {
        isNormalUser = true;
        group = username;
        extraGroups = [
          "wheel"
          "networkmanager"
        ];
        home = homeDir;
        shell = pkgs.bash;
      };
      users.groups.${username} = { };
      environment.systemPackages = [
        pkgs.curl
        pkgs.jq
      ];
      systemd.tmpfiles.rules = [ "d ${homeDir}/.nixpi 0755 ${username} ${username} -" ];

      system.activationScripts.nixpi-bootstrap = lib.stringAfter [ "users" ] ''
          mkdir -p ${homeDir}/.nixpi
          install -d -m 0755 /etc/nixos
          cat > /etc/nixos/configuration.nix <<'EOF'
        { ... }:
        {
          networking.hostName = "${hostName}";
        }
        EOF
          cat > /etc/nixos/hardware-configuration.nix <<'EOF'
        { ... }:
        {}
        EOF
          ${lib.getExe' pkgs.bash "bash"} ${initSystemFlake} /srv/nixpi ${hostName} ${username} UTC us
          chown -R ${username}:${username} ${homeDir}/.nixpi
          chmod 755 ${homeDir}/.nixpi
      '';
    };
in
{
  name = "nixpi-firstboot";

  nodes = {
    nixpi = mkNode { hostName = "nixpi-firstboot-test"; };
  };

  testScript = ''
    nixpi = machines[0]
    home = "/home/pi"

    nixpi.start()
    nixpi.wait_for_unit("multi-user.target", timeout=300)
    nixpi.wait_for_unit("network-online.target", timeout=60)
    nixpi.wait_for_unit("wireguard-wg0.service", timeout=60)
    nixpi.wait_for_unit("nixpi-chat.service", timeout=120)
    nixpi.wait_for_unit("nixpi-ttyd.service", timeout=120)
    nixpi.wait_for_unit("nginx.service", timeout=120)
    nixpi.wait_until_succeeds("curl -sf http://127.0.0.1:8080/ | grep -q 'nixpi-shell'", timeout=60)
    nixpi.wait_until_succeeds(
        "test \"$(curl -s -o /dev/null -w '%{http_code}' -X POST "
        + "http://127.0.0.1:8080/chat -H 'Content-Type: application/json' -d '{}')\" = 400",
        timeout=60,
    )
    nixpi.wait_until_succeeds("curl -sf http://127.0.0.1/terminal/ >/dev/null", timeout=60)
    nixpi.succeed("test -d " + home + "/.nixpi")
    nixpi.wait_until_succeeds("test ! -f " + home + "/.nixpi/wizard-state/system-ready", timeout=60)
    nixpi.fail("test -f " + home + "/.nixpi/.setup-complete")

    nixpi.succeed("test -d " + home + "/.pi")
    nixpi.succeed("test -f " + home + "/.pi/settings.json")
    nixpi.succeed("test ! -L " + home + "/.pi")
    nixpi.succeed("test \"$(stat -c %U " + home + "/.pi)\" = pi")
    nixpi.fail("test -e " + home + "/nixpi/.git")
    nixpi.fail("test -e " + home + "/nixpi/flake.nix")
    nixpi.fail("test -e /var/lib/nixpi/pi-nixpi")
    nixpi.succeed("test -f /etc/nixos/flake.nix")
    nixpi.fail("test -e /etc/nixos/nixpi-host.nix")
    nixpi.fail("test -e /etc/nixos/nixpi-integration.nix")
    nixpi.succeed("grep -q 'nixosConfigurations.nixos' /etc/nixos/flake.nix")
    nixpi.fail("test -e /etc/nixpi/canonical-repo.json")
    nixpi.fail("command -v nixpi-bootstrap-ensure-repo-target")
    nixpi.fail("command -v nixpi-bootstrap-prepare-repo")
    nixpi.fail("command -v nixpi-bootstrap-nixos-rebuild-switch")
    nixpi.fail("command -v codex")
    nixpi.succeed("systemctl is-enabled nixpi-chat.service")

    nixpi.succeed(
        "su - pi -c 'test \"$PI_CODING_AGENT_DIR\" = /home/pi/.pi; "
        + "pi --help | grep -q \"AI coding assistant\"'"
    )

    print("All nixpi-firstboot tests passed!")
  '';
}
