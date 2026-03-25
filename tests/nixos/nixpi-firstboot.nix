{ lib, nixPiModulesNoShell, piAgent, appPackage, setupPackage, mkTestFilesystems, ... }:

let
  repoSource = lib.cleanSource ../..;
  bootstrapRepoDir = "/var/lib/nixpi-bootstrap";
  bootstrapOriginDir = "${bootstrapRepoDir}/origin.git";
  bootstrapRepoUrl = "file://${bootstrapOriginDir}";
  mkNode =
    { prefillEnv ? ''
        PREFILL_USERNAME=testuser
        PREFILL_MATRIX_PASSWORD=testpassword123
        NIXPI_BOOTSTRAP_REPO=${bootstrapRepoUrl}
      ''
    , hostName ? "nixpi-firstboot-test"
    , extraActivation ? (_pkgs: "")
    }:
    { pkgs, ... }:
    let
      username = "pi";
      homeDir = "/home/${username}";
    in
    {
      imports = nixPiModulesNoShell ++ [
        ../../core/os/modules/firstboot
        mkTestFilesystems
      ];
      _module.args = { inherit piAgent appPackage setupPackage; };
      nixpi.primaryUser = username;

      virtualisation.diskSize = 20480;
      virtualisation.memorySize = 4096;

      boot.loader.systemd-boot.enable = true;
      boot.loader.efi.canTouchEfiVariables = true;
      networking.hostName = hostName;
      time.timeZone = "UTC";
      i18n.defaultLocale = "en_US.UTF-8";
      networking.networkmanager.enable = true;
      system.stateVersion = "25.05";
      users.users.${username} = {
        isNormalUser = true;
        group = username;
        extraGroups = [ "wheel" "networkmanager" ];
        home = homeDir;
        shell = pkgs.bash;
      };
      users.groups.${username} = {};
      environment.systemPackages = [ pkgs.curl pkgs.jq ];
      systemd.tmpfiles.rules = [
        "d ${homeDir}/.nixpi 0755 ${username} ${username} -"
        "f ${homeDir}/.nixpi/prefill.env 0644 ${username} ${username} -"
      ];

      system.activationScripts.nixpi-prefill = lib.stringAfter [ "users" ] (
        ''
          mkdir -p ${homeDir}/.nixpi
          install -d -m 0755 /etc/nixos
          cat > /etc/nixos/nixpi-install.nix <<'EOF'
        { ... }:
        {
          networking.hostName = "${hostName}";
          nixpi.primaryUser = "${username}";
        }
        EOF
          rm -rf ${bootstrapRepoDir}
          mkdir -p ${bootstrapRepoDir}/worktree
          cp -R ${repoSource}/. ${bootstrapRepoDir}/worktree/
          chmod -R u+w ${bootstrapRepoDir}/worktree
          ${pkgs.git}/bin/git -C ${bootstrapRepoDir}/worktree init --initial-branch main
          ${pkgs.git}/bin/git -C ${bootstrapRepoDir}/worktree config user.name "NixPI Test"
          ${pkgs.git}/bin/git -C ${bootstrapRepoDir}/worktree config user.email "nixpi-tests@example.invalid"
          ${pkgs.git}/bin/git -C ${bootstrapRepoDir}/worktree add .
          ${pkgs.git}/bin/git -C ${bootstrapRepoDir}/worktree commit -m "bootstrap source"
          ${pkgs.git}/bin/git init --bare --initial-branch main ${bootstrapOriginDir}
          ${pkgs.git}/bin/git -C ${bootstrapRepoDir}/worktree remote add origin ${bootstrapOriginDir}
          ${pkgs.git}/bin/git -C ${bootstrapRepoDir}/worktree push ${bootstrapOriginDir} main
          cat > ${homeDir}/.nixpi/prefill.env << 'EOF'
        ${prefillEnv}
        EOF
          chown -R ${username}:${username} ${homeDir}/.nixpi
          chmod 755 ${homeDir}/.nixpi
          chmod 644 ${homeDir}/.nixpi/prefill.env
        ''
        + lib.optionalString (extraActivation pkgs != "") ''
          ${extraActivation pkgs}
        ''
      );
    };
in
{
  name = "nixpi-firstboot";

  nodes = {
    nixpi = mkNode { hostName = "nixpi-firstboot-test"; };
    bootstrapMissingGit = mkNode {
      hostName = "nixpi-firstboot-missing-git";
      extraActivation = _pkgs: ''
        install -d -o pi -g pi -m 0755 /home/pi/.nixpi/wizard-state
        touch /home/pi/.nixpi/wizard-state/welcome
        touch /home/pi/.nixpi/wizard-state/network
        touch /home/pi/.nixpi/wizard-state/locale
        touch /home/pi/.nixpi/wizard-state/password
        chown -R pi:pi /home/pi/.nixpi
        install -d -o pi -g pi -m 0755 /srv/nixpi
        touch /srv/nixpi/not-a-repo
        chown pi:pi /srv/nixpi/not-a-repo
      '';
    };
    bootstrapWrongOrigin = mkNode {
      hostName = "nixpi-firstboot-wrong-origin";
      extraActivation = pkgs: ''
        install -d -o pi -g pi -m 0755 /home/pi/.nixpi/wizard-state
        touch /home/pi/.nixpi/wizard-state/welcome
        touch /home/pi/.nixpi/wizard-state/network
        touch /home/pi/.nixpi/wizard-state/locale
        touch /home/pi/.nixpi/wizard-state/password
        chown -R pi:pi /home/pi/.nixpi
        install -d -o pi -g pi -m 0755 /srv/nixpi
        ${pkgs.git}/bin/git init --initial-branch main /srv/nixpi
        ${pkgs.git}/bin/git -C /srv/nixpi remote add origin https://example.invalid/not-nixpi.git
        chown -R pi:pi /srv/nixpi
      '';
    };
  };

  testScript = ''
    import json
    import urllib.parse

    bootstrap_missing_git = machines[0]
    bootstrap_wrong_origin = machines[1]
    nixpi = machines[2]
    home = "/home/pi"
    username = "pi"

    nixpi.start()
    nixpi.wait_for_unit("multi-user.target", timeout=300)
    nixpi.wait_for_unit("network-online.target", timeout=60)
    nixpi.wait_for_unit("netbird.service", timeout=60)

    nixpi.succeed("systemctl stop continuwuity.service")
    nixpi.succeed("su - pi -c 'setup-wizard.sh'")

    nixpi.wait_for_unit("continuwuity.service", timeout=120)
    nixpi.succeed("test -f " + home + "/.nixpi/wizard-state/system-ready")
    nixpi.fail("test -f " + home + "/.nixpi/.setup-complete")
    nixpi.succeed("test -f " + home + "/.nixpi/prefill.env")
    nixpi.succeed("test -f " + home + "/.nixpi/wizard.log")
    log_content = nixpi.succeed("cat " + home + "/.nixpi/wizard.log")
    print("=== Firstboot log content ===")
    print(log_content)
    print("=== End of log ===")
    assert "NixPI Wizard Started" in log_content, "Wizard log missing start marker"
    assert "Timezone: UTC [default for noninteractive setup]" in log_content, (
        "Firstboot log missing noninteractive timezone default"
    )
    assert "Keyboard layout: us [default for noninteractive setup]" in log_content, (
        "Firstboot log missing noninteractive keyboard default"
    )
    assert "command not found" not in log_content, "Wizard log contains shell execution errors"
    assert "setup complete" in log_content.lower(), "Firstboot log missing completion marker"

    nixpi.succeed("test -d " + home + "/.nixpi/wizard-state")

    checkpoints = nixpi.succeed("ls " + home + "/.nixpi/wizard-state/ 2>/dev/null || true").strip().split('\n')
    checkpoints = [c for c in checkpoints if c]
    assert len(checkpoints) > 0, f"No checkpoints found in wizard-state. Found: {checkpoints}"

    nixpi.succeed("test -d " + home + "/.pi")
    nixpi.succeed("test -f " + home + "/.pi/settings.json")
    nixpi.succeed("test -f " + home + "/.pi/matrix-credentials.json")
    nixpi.succeed("test ! -L " + home + "/.pi")
    nixpi.succeed("test \"$(stat -c %U " + home + "/.pi)\" = pi")
    nixpi.succeed("test -d /srv/nixpi/.git")
    nixpi.fail("test -e " + home + "/nixpi")
    nixpi.fail("test -e /var/lib/nixpi/pi-nixpi")
    nixpi.succeed("grep -q '/srv/nixpi' /etc/nixos/flake.nix")
    nixpi.fail("test -f /etc/nixos/flake.lock")
    nixpi.succeed("test -f /etc/nixpi/canonical-repo.json")

    canonical_repo = json.loads(nixpi.succeed("cat /etc/nixpi/canonical-repo.json"))
    assert canonical_repo == {
        "path": "/srv/nixpi",
        "origin": "${bootstrapRepoUrl}",
        "branch": "main",
    }, canonical_repo

    nixpi.succeed("su - pi -c 'cd /srv/nixpi && git switch -c feature/test'")
    nixpi.fail("nixos-rebuild build --impure --flake /etc/nixos#nixpi > /tmp/non-main-rebuild.log 2>&1")
    nixpi.succeed("grep -q 'Supported rebuilds require /srv/nixpi to be on main' /tmp/non-main-rebuild.log")
    nixpi.succeed("su - pi -c 'cd /srv/nixpi && git switch main'")

    creds = json.loads(nixpi.succeed("cat " + home + "/.pi/matrix-credentials.json"))
    bot_token = creds["botAccessToken"]
    bot_user_id = creds["botUserId"]
    server_name = bot_user_id.split(":", 1)[1]
    admin_alias = f"#admins:{server_name}"
    admin_alias_path = urllib.parse.quote(admin_alias, safe="")
    room_info = json.loads(
        nixpi.succeed(
            "curl -sf -H "
            + "'Authorization: Bearer "
            + bot_token
            + "' "
            + "'http://127.0.0.1:6167/_matrix/client/v3/directory/room/"
            + admin_alias_path
            + "'"
        )
    )
    admin_room_id = room_info["room_id"]
    joined_rooms = json.loads(
        nixpi.succeed(
            "curl -sf -H "
            + "'Authorization: Bearer "
            + bot_token
            + "' "
            + "'http://127.0.0.1:6167/_matrix/client/v3/joined_rooms'"
        )
    )
    assert admin_room_id in joined_rooms["joined_rooms"], (
        f"Pi bot {bot_user_id} was not joined to {admin_alias}: {joined_rooms}"
    )

    nixpi.succeed(
        "su - pi -c '. ~/.bashrc; test \"$PI_CODING_AGENT_DIR\" = /home/pi/.pi; "
        + "pi --help | grep -q \"AI coding assistant\"'"
    )

    bootstrap_missing_git.start()
    bootstrap_missing_git.wait_for_unit("multi-user.target", timeout=300)
    bootstrap_missing_git.wait_for_unit("network-online.target", timeout=60)
    bootstrap_missing_git.wait_for_unit("netbird.service", timeout=60)
    bootstrap_missing_git.succeed("systemctl stop continuwuity.service")
    bootstrap_missing_git.fail("su - pi -c 'setup-wizard.sh' > /tmp/bootstrap-missing-git.log 2>&1")
    bootstrap_missing_git.succeed("grep -Eq 'Refusing to overwrite existing non-git directory|canonical repo checkout is missing \\.git' /home/pi/.nixpi/bootstrap/full-appliance-upgrade.log")

    bootstrap_wrong_origin.start()
    bootstrap_wrong_origin.wait_for_unit("multi-user.target", timeout=300)
    bootstrap_wrong_origin.wait_for_unit("network-online.target", timeout=60)
    bootstrap_wrong_origin.wait_for_unit("netbird.service", timeout=60)
    bootstrap_wrong_origin.succeed("systemctl stop continuwuity.service")
    bootstrap_wrong_origin.succeed("test -d /srv/nixpi/.git")
    bootstrap_wrong_origin.fail("su - pi -c 'setup-wizard.sh' > /tmp/bootstrap-wrong-origin.log 2>&1")
    bootstrap_wrong_origin.succeed("grep -Eq 'unexpected origin URL|canonical repo origin mismatch' /home/pi/.nixpi/bootstrap/full-appliance-upgrade.log")

    print("All nixpi-firstboot tests passed!")
  '';
}
