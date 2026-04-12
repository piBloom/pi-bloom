{
  mkTestFilesystems,
  ...
}:

let
  username = "pi";
  homeDir = "/home/${username}";
in
{
  name = "nixpi-e2e";

  nodes = {
    nixpi =
      { pkgs, ... }:
      {
        imports = [
          ../../core/os/hosts/vps.nix
          mkTestFilesystems
        ];

        nixpi = {
          primaryUser = username;
          bootstrap.enable = false;
          bootstrap.ssh.enable = true;
          bootstrap.temporaryAdmin.enable = false;
          security.ssh.allowedSourceCIDRs = [ "192.0.2.10/32" ];
        };

        virtualisation.diskSize = 20480;
        virtualisation.memorySize = 4096;

        networking.hostName = "pi";
        time.timeZone = "UTC";
        i18n.defaultLocale = "en_US.UTF-8";
        networking.networkmanager.enable = true;
        system.stateVersion = "25.05";
        boot.loader.systemd-boot.enable = true;
        boot.loader.efi.canTouchEfiVariables = true;

        systemd.tmpfiles.rules = [ "d ${homeDir}/.nixpi 0755 ${username} ${username} -" ];
      };

    client =
      { pkgs, ... }:
      {
        virtualisation.diskSize = 5120;
        virtualisation.memorySize = 1024;

        networking.hostName = "client";
        time.timeZone = "UTC";
        i18n.defaultLocale = "en_US.UTF-8";
        networking.networkmanager.enable = true;
        system.stateVersion = "25.05";
        boot.loader.systemd-boot.enable = true;
        boot.loader.efi.canTouchEfiVariables = true;

        environment.systemPackages = with pkgs; [
          curl
          netcat
          openssh
          jq
        ];
      };
  };

  testScript = ''
    client = machines[0]
    nixpi = machines[1]
    username = "pi"
    home = "/home/pi"

    nixpi.start()
    nixpi.wait_for_unit("multi-user.target", timeout=300)
    nixpi.wait_until_succeeds("ip -4 addr show dev eth1 | grep -q 'inet '", timeout=60)
    nixpi.wait_for_unit("nixpi-app-setup.service", timeout=120)
    nixpi.wait_for_unit("sshd.service", timeout=60)
    client.start()
    client.wait_until_succeeds("ip -4 addr show dev eth1 | grep -q 'inet '", timeout=60)

    client.succeed("ping -c 3 pi")

    nixpi.fail("sudo -u pi -- sudo -n true")

    client.succeed("nc -z -w 2 pi 22")

    services = ["NetworkManager"]
    for svc in services:
        nixpi.succeed("systemctl is-active " + svc + ".service")

    nixpi.fail("test -e " + home + "/nixpi/.git")
    nixpi.fail("test -e " + home + "/nixpi/flake.nix")
    nixpi.succeed("test -d " + home + "/.nixpi")
    nixpi.succeed("test -d " + home + "/.pi")
    nixpi.succeed("test ! -L " + home + "/.pi")
    nixpi.succeed("test -d /usr/local/share/nixpi")
    nixpi.fail("test -e /srv/nixpi")
    nixpi.fail("test -f /etc/nixos/flake.nix")
    nixpi.fail("test -e /etc/nixos/nixpi-host.nix")
    nixpi.fail("test -e /etc/nixos/nixpi-integration.nix")

    groups = nixpi.succeed("groups " + username).strip()
    assert "wheel" in groups, "User not in wheel group: " + groups
    assert "networkmanager" in groups, "User not in networkmanager group: " + groups

    for port in [80, 443]:
        client.succeed(f"! nc -z -w 2 pi {port}")

    packages = ["git", "curl", "jq", "htop"]
    for pkg in packages:
        nixpi.succeed("command -v " + pkg)

    nixpi.fail("command -v codex")
    nixpi.succeed("sudo -u pi -- bash -lc 'command -v pi'")

    nixpi.succeed("getent hosts pi")
    nixpi.succeed("getent hosts client")

    print("=" * 60)
    print("All E2E tests passed!")
    print("=" * 60)
    print("Verified:")
    print("  - Host mode is selected declaratively from NixOS config")
    print("  - SSH remains reachable on the LAN in steady-state")
    print("  - App ports stay closed without the old overlay path")
    print("  - All core services start correctly")
    print("  - Network connectivity between nodes")
    print("  - File system and user setup correct")
    print("=" * 60)
  '';
}
