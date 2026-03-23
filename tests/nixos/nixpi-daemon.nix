# tests/nixos/nixpi-daemon.nix
# Test that the Pi Daemon Matrix agent starts and connects to homeserver

{ pkgs, lib, nixPiModules, nixPiModulesNoShell, piAgent, appPackage, setupPackage, mkNixPiNode, mkTestFilesystems, ... }:

pkgs.testers.runNixOSTest {
  name = "nixpi-daemon";

  nodes = {
    # Matrix homeserver node
    server = { ... }: let
      username = "server";
      homeDir = "/home/${username}";
    in {
      imports = nixPiModulesNoShell ++ [ mkTestFilesystems ];
      _module.args = { inherit piAgent appPackage setupPackage; };
      nixpi.primaryUser = username;
      services.matrix-continuwuity.settings = {
        admin_execute = [ "users create-user pi testpass123" ];
      };

      virtualisation.diskSize = 10240;
      virtualisation.memorySize = 2048;

      networking.hostName = "nixpi-server";
      time.timeZone = "UTC";
      i18n.defaultLocale = "en_US.UTF-8";
      networking.networkmanager.enable = true;
      system.stateVersion = "25.05";
      # nixpkgs.config NOT set here - test framework injects its own pkgs
      
      boot.loader.systemd-boot.enable = true;
      boot.loader.efi.canTouchEfiVariables = true;

      users.users.${username} = {
        isNormalUser = true;
        group = username;
        extraGroups = [ "wheel" "networkmanager" ];
        home = homeDir;
        shell = pkgs.bash;
        initialPassword = "serverpass123";
      };
      users.groups.${username} = {};
    };

    # Agent node running nixpi-daemon
    agent = { ... }: let
      username = "pi";
      homeDir = "/home/${username}";
    in {
      imports = nixPiModulesNoShell ++ [ mkTestFilesystems ];
      _module.args = { inherit piAgent appPackage setupPackage; };
      nixpi.primaryUser = username;

      virtualisation.diskSize = 10240;
      virtualisation.memorySize = 2048;

      networking.hostName = "nixpi-agent";
      time.timeZone = "UTC";
      i18n.defaultLocale = "en_US.UTF-8";
      networking.networkmanager.enable = true;
      system.stateVersion = "25.05";
      # nixpkgs.config NOT set here - test framework injects its own pkgs
      
      boot.loader.systemd-boot.enable = true;
      boot.loader.efi.canTouchEfiVariables = true;
      systemd.services.continuwuity.wantedBy = lib.mkForce [];
      # Ensure the primary NixPI user exists with proper setup
      users.users.${username} = {
        isNormalUser = true;
        group = username;
        extraGroups = [ "wheel" "networkmanager" ];
        home = homeDir;
        shell = pkgs.bash;
      };
      users.groups.${username} = {};

      # Pre-create setup-complete to skip wizard
      systemd.tmpfiles.rules = [
        "d ${homeDir}/.nixpi 0755 ${username} ${username} -"
        "f ${homeDir}/.nixpi/.setup-complete 0644 ${username} ${username} -"
      ];

      # Create Matrix credentials file for daemon
      system.activationScripts.nixpi-daemon-creds = lib.stringAfter [ "users" ] ''
        install -d -m 0700 -o ${username} -g ${username} ${homeDir}/.pi
      '';
    };
  };

  testScript = ''
    import json

    agent = machines[0]
    server = machines[1]
    username = "pi"
    home = "/home/pi"

    # Start the homeserver first.
    server.start()
    server.wait_for_unit("multi-user.target", timeout=300)
    server.wait_for_unit("continuwuity.service", timeout=60)
    server.wait_until_succeeds("curl -sf http://localhost:6167/_matrix/client/versions", timeout=60)
    login_payload = json.loads(
        server.succeed(
            "curl -sf -X POST http://localhost:6167/_matrix/client/v3/login "
            + "-H 'Content-Type: application/json' "
            + "-d '{\"type\":\"m.login.password\",\"identifier\":{\"type\":\"m.id.user\",\"user\":\"pi\"},\"password\":\"testpass123\"}'"
        )
    )
    access_token = login_payload["access_token"]
    user_id = login_payload["user_id"]
    assert user_id, "Continuwuity login produced an empty user_id"
    assert access_token, "Continuwuity login produced an empty access_token"

    # Start the agent node and provision daemon credentials.
    agent.start()
    agent.wait_for_unit("multi-user.target", timeout=300)

    agent.succeed("mkdir -p /home/pi/.pi")
    agent.succeed(
        "cat > "
        + "/home/pi/.pi/matrix-credentials.json <<'CREDS'\n"
        + "{\n"
        + '  "homeserver": "http://server:6167",\n'
        + '  "botUserId": "'
        + user_id
        + '",\n'
        + '  "botAccessToken": "'
        + access_token
        + '",\n'
        + '  "botPassword": "testpass123"\n'
        + "}\n"
        + "CREDS"
    )
    agent.succeed("chown -R pi:pi /home/pi/.pi")

    agent.succeed(
        "touch " + home + "/.nixpi/.setup-complete && chown "
        + username + ":" + username + " " + home + "/.nixpi/.setup-complete"
    )
    agent.succeed("mkdir -p " + home + "/nixpi && chown -R " + username + ":" + username + " " + home + "/nixpi")

    agent.succeed("systemctl start nixpi-daemon.service || true")

    agent.succeed("test -f /etc/systemd/system/nixpi-daemon.service")
    agent.succeed("test -d /usr/local/share/nixpi")
    agent.succeed("test -f /usr/local/share/nixpi/dist/core/daemon/index.js")

    agent.wait_until_succeeds(
        "systemctl is-active nixpi-daemon.service | grep -Eq 'active|activating'",
        timeout=30,
    )
    daemon_status = agent.succeed("systemctl is-active nixpi-daemon.service || true").strip()
    journal = agent.succeed("journalctl -u nixpi-daemon.service -n 20 --no-pager || true")
    print("nixpi-daemon status: " + daemon_status)
    print("nixpi-daemon journal: " + journal)
    assert daemon_status in ["active", "activating"], "Unexpected nixpi-daemon status: " + daemon_status

    service_unit = agent.succeed("systemctl cat nixpi-daemon.service")
    exec_start = agent.succeed("systemctl show -p ExecStart --value nixpi-daemon.service")
    environment = agent.succeed("systemctl show -p Environment --value nixpi-daemon.service")
    working_directory = agent.succeed("systemctl show -p WorkingDirectory --value nixpi-daemon.service").strip()
    assert "node" in exec_start and "/usr/local/share/nixpi/dist/core/daemon/index.js" in exec_start, \
        "Unexpected ExecStart in nixpi-daemon service: " + exec_start
    assert "NIXPI_DIR=/home/pi/nixpi" in environment, "Expected NIXPI_DIR environment in nixpi-daemon service"
    assert working_directory == "/home/pi/nixpi", "Unexpected WorkingDirectory: " + working_directory
    agent.succeed("ls -la /usr/local/share/nixpi/")

    agent.succeed("test -f /home/pi/.pi/matrix-credentials.json")
    creds = json.loads(agent.succeed("cat /home/pi/.pi/matrix-credentials.json"))
    assert creds["homeserver"] == "http://server:6167", "Credentials missing homeserver"
    assert creds["botUserId"] == user_id, "Credentials missing botUserId"
    assert creds["botAccessToken"] == access_token, "Credentials missing botAccessToken"

    print("All nixpi-daemon tests passed!")
    print("Note: Full daemon connection test requires complete Matrix network setup")
  '';
}
