# tests/nixos/workspace-home.nix
# Test that Workspace Home and the built-in user services are provisioned after firstboot

{ pkgs, lib, workspaceModulesNoShell, piAgent, appPackage, mkTestFilesystems, ... }:

pkgs.testers.runNixOSTest {
  name = "workspace-home";

  nodes.workspace = { ... }: let
    username = "workspace";
    homeDir = "/home/${username}";
  in {
    imports = workspaceModulesNoShell ++ [
      ../../core/os/modules/firstboot.nix
      mkTestFilesystems
    ];
    _module.args = { inherit piAgent appPackage; };
    nixpi.username = username;

    virtualisation.diskSize = 20480;
    virtualisation.memorySize = 4096;

    boot.loader.systemd-boot.enable = true;
    boot.loader.efi.canTouchEfiVariables = true;
    networking.hostName = "workspace-home-test";
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

    systemd.tmpfiles.rules = [
      "d ${homeDir}/.workspace 0755 ${username} ${username} -"
      "f ${homeDir}/.workspace/prefill.env 0644 ${username} ${username} -"
    ];

    system.activationScripts.workspace-prefill = lib.stringAfter [ "users" ] ''
      mkdir -p ${homeDir}/.workspace
      cat > ${homeDir}/.workspace/prefill.env << 'EOF'
    PREFILL_USERNAME=testuser
    PREFILL_MATRIX_PASSWORD=testpassword123
    EOF
      chown -R ${username}:${username} ${homeDir}/.workspace
      chmod 755 ${homeDir}/.workspace
      chmod 644 ${homeDir}/.workspace/prefill.env
    '';
  };

  testScript = ''
    workspace = machines[0]
    home = "/home/workspace"

    workspace.start()
    workspace.wait_for_unit("multi-user.target", timeout=300)
    workspace.wait_for_unit("nixpi-firstboot.service", timeout=120)
    workspace.wait_until_succeeds("test -f " + home + "/.workspace/.setup-complete", timeout=120)

    workspace.wait_until_succeeds("test -f " + home + "/.config/workspace/home/index.html", timeout=120)
    workspace.wait_until_succeeds("test -f " + home + "/.config/workspace/fluffychat/config.json", timeout=120)
    workspace.succeed("grep -q 'Workspace Home' " + home + "/.config/workspace/home/index.html")
    workspace.succeed("grep -q 'Workspace Web Chat' " + home + "/.config/workspace/home/index.html")
    workspace.succeed("grep -q 'Workspace Files' " + home + "/.config/workspace/home/index.html")
    workspace.succeed("grep -q 'Workspace Code' " + home + "/.config/workspace/home/index.html")

    workspace.wait_until_succeeds("curl -sf http://127.0.0.1:8080 | grep -q 'Workspace Home'", timeout=60)
    workspace.wait_until_succeeds("curl -sf http://127.0.0.1:8080 | grep -q '8081'", timeout=60)
    workspace.wait_until_succeeds("curl -sf http://127.0.0.1:8080 | grep -q '5000'", timeout=60)
    workspace.wait_until_succeeds("curl -sf http://127.0.0.1:8080 | grep -q '8443'", timeout=60)
    workspace.wait_until_succeeds("curl -sf http://127.0.0.1:8081/config.json | grep -q 'defaultHomeserver'", timeout=60)
    workspace.wait_until_succeeds("curl -sf http://127.0.0.1:5000/ >/dev/null", timeout=60)
    workspace.wait_until_succeeds("curl -sf http://127.0.0.1:8443/ | grep -q 'code-server'", timeout=60)
    workspace.succeed("test -d " + home + "/.config/code-server")

    print("Workspace Home and built-in service tests passed!")
  '';
}
