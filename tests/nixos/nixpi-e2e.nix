{
  lib,
  nixPiModulesNoShell,
  mkTestFilesystems,
  ...
}:

let
  initSystemFlake = ../../core/scripts/nixpi-init-system-flake.sh;
in
{
  name = "nixpi-e2e";

  nodes = {
    nixpi =
      { pkgs, ... }:
      let
        username = "pi";
        homeDir = "/home/${username}";
      in
      {
        imports = nixPiModulesNoShell ++ [
          mkTestFilesystems
        ];
        nixpi.primaryUser = username;

        virtualisation.diskSize = 20480;
        virtualisation.memorySize = 4096;

        networking.hostName = "pi";
        time.timeZone = "UTC";
        i18n.defaultLocale = "en_US.UTF-8";
        networking.networkmanager.enable = true;
        system.stateVersion = "25.05";
        boot.loader.systemd-boot.enable = true;
        boot.loader.efi.canTouchEfiVariables = true;

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
        system.activationScripts.nixpi-e2e-bootstrap = lib.stringAfter [ "users" ] ''
              mkdir -p ${homeDir}/.nixpi
              install -d -m 0755 /etc/nixos
              cat > /etc/nixos/configuration.nix <<'EOF'
          { ... }:
          {
            networking.hostName = "pi";
          }
          EOF
              cat > /etc/nixos/hardware-configuration.nix <<'EOF'
          { ... }:
          {}
          EOF
              ${lib.getExe' pkgs.bash "bash"} ${initSystemFlake} /srv/nixpi pi ${username} UTC us
              chown -R ${username}:${username} ${homeDir}/.nixpi
              chmod 755 ${homeDir}/.nixpi
        '';
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
    nixpi.wait_until_succeeds("curl -sf http://127.0.0.1:8080/ | grep -q 'nixpi-shell'", timeout=60)
    client.start()
    client.wait_until_succeeds("ip -4 addr show dev eth1 | grep -q 'inet '", timeout=60)

    client.succeed("ping -c 3 pi")

    apply_output = nixpi.succeed(
        "env NIXPI_PRIMARY_USER=pi nixpi-setup-apply | tee /tmp/setup-apply.out"
    )
    print(apply_output)
    assert "SETUP_FAILED" not in apply_output, apply_output
    nixpi.wait_until_succeeds("test -f " + home + "/.nixpi/wizard-state/system-ready", timeout=180)
    nixpi.fail("test -f " + home + "/.nixpi/.setup-complete")

    client.succeed("nc -z -w 2 pi 22")

    services = ["wireguard-wg0", "NetworkManager"]
    for svc in services:
        nixpi.succeed("systemctl is-active " + svc + ".service")

    nixpi.fail("test -e " + home + "/nixpi/.git")
    nixpi.fail("test -e " + home + "/nixpi/flake.nix")
    nixpi.succeed("test -d " + home + "/.nixpi")
    nixpi.succeed("test -d " + home + "/.pi")
    nixpi.succeed("test ! -L " + home + "/.pi")
    nixpi.succeed("test -d /usr/local/share/nixpi")
    nixpi.succeed("test -f /etc/nixos/flake.nix")
    nixpi.fail("test -e /etc/nixos/nixpi-host.nix")
    nixpi.fail("test -e /etc/nixos/nixpi-integration.nix")
    nixpi.succeed("grep -q 'nixosConfigurations.nixos' /etc/nixos/flake.nix")
    nixpi.fail("command -v nixpi-bootstrap-ensure-repo-target")
    nixpi.fail("command -v nixpi-bootstrap-prepare-repo")
    nixpi.fail("command -v nixpi-bootstrap-nixos-rebuild-switch")

    groups = nixpi.succeed("groups " + username).strip()
    assert "wheel" in groups, "User not in wheel group: " + groups
    assert "networkmanager" in groups, "User not in networkmanager group: " + groups

    nixpi.succeed("systemctl is-active wireguard-wg0.service")

    for port in [8080, 8081, 5000, 8443]:
        client.succeed(f"! nc -z -w 2 pi {port}")

    packages = ["git", "curl", "jq", "htop", "wg"]
    for pkg in packages:
        nixpi.succeed("command -v " + pkg)

    nixpi.fail("command -v codex")
    nixpi.succeed("su - pi -c 'command -v pi'")

    nixpi.succeed("getent hosts pi")
    nixpi.succeed("getent hosts client")

    print("=" * 60)
    print("All E2E tests passed!")
    print("=" * 60)
    print("Verified:")
    print("  - Web setup apply completed")
    print("  - SSH remains reachable on the LAN after setup")
    print("  - App ports stay closed without wg0 access")
    print("  - Setup API completes")
    print("  - All core services start correctly")
    print("  - Network connectivity between nodes")
    print("  - File system and user setup correct")
    print("=" * 60)
  '';
}
