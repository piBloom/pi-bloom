{ lib, nixPiModulesNoShell, piAgent, appPackage, setupPackage, mkTestFilesystems, ... }:

{
  name = "nixpi-home";

  nodes.nixpi = { pkgs, ... }: let
    username = "pi";
    homeDir = "/home/${username}";
  in {
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
    networking.hostName = "nixpi-home-test";
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
      "d ${homeDir}/.nixpi 0755 ${username} ${username} -"
      "f ${homeDir}/.nixpi/prefill.env 0644 ${username} ${username} -"
    ];

    system.activationScripts.nixpi-prefill = lib.stringAfter [ "users" ] ''
      mkdir -p ${homeDir}/.nixpi
      install -d -m 0755 /etc/nixos
      cat > /etc/nixos/nixpi-install.nix <<'EOF'
    { ... }:
    {
      networking.hostName = "nixpi-home-test";
      nixpi.primaryUser = "${username}";
    }
    EOF
      cat > ${homeDir}/.nixpi/prefill.env << 'EOF'
    PREFILL_USERNAME=testuser
    PREFILL_MATRIX_PASSWORD=testpassword123
    EOF
      chown -R ${username}:${username} ${homeDir}/.nixpi
      chmod 755 ${homeDir}/.nixpi
      chmod 644 ${homeDir}/.nixpi/prefill.env
    '';
  };

  testScript = ''
    nixpi = machines[0]
    home = "/home/pi"

    nixpi.start()
    nixpi.wait_for_unit("multi-user.target", timeout=300)
    nixpi.succeed("su - pi -c 'setup-wizard.sh'")
    nixpi.wait_until_succeeds("test -f " + home + "/.nixpi/wizard-state/system-ready", timeout=120)

    nixpi.wait_until_succeeds("test -f /etc/system-services/nixpi-home/webroot/index.html", timeout=120)
    nixpi.wait_until_succeeds("test -f /etc/system-services/nixpi-element-web/config.json", timeout=120)
    nixpi.wait_until_succeeds("test -f " + home + "/.config/nixpi/services/element-web/config.json", timeout=120)
    nixpi.wait_until_succeeds("test -f " + home + "/.config/nixpi/services/home/index.html", timeout=120)
    nixpi.succeed("grep -q 'NixPI Home' /etc/system-services/nixpi-home/webroot/index.html")
    nixpi.succeed("grep -q 'Element Web' /etc/system-services/nixpi-home/webroot/index.html")
    nixpi.succeed("grep -q 'Matrix' /etc/system-services/nixpi-home/webroot/index.html")
    nixpi.succeed("grep -q 'Canonical access' /etc/system-services/nixpi-home/webroot/index.html")
    nixpi.succeed("grep -q 'canonical host not available on localhost recovery' /etc/system-services/nixpi-home/webroot/index.html")
    nixpi.fail("grep -q 'https://nixpi/' /etc/system-services/nixpi-home/webroot/index.html")
    nixpi.succeed("grep -q 'http://localhost/' " + home + "/.config/nixpi/services/home/index.html")
    nixpi.succeed("grep -q 'use localhost only as an on-box recovery path' " + home + "/.config/nixpi/services/home/index.html")
    nixpi.fail("grep -q 'Home direct port' " + home + "/.config/nixpi/services/home/index.html")
    nixpi.fail("grep -q ':8443' " + home + "/.config/nixpi/services/home/index.html")
    nixpi.fail("grep -q 'mesh IP' " + home + "/.config/nixpi/services/home/index.html")
    nixpi.fail("grep -q 'http://localhost:6167' " + home + "/.config/nixpi/services/element-web/config.json")
    nixpi.fail("test -e " + home + "/.config/nixpi/services/chat/config.json")

    nixpi.wait_until_succeeds("curl -sf http://127.0.0.1:8080 | grep -q 'NixPI Home'", timeout=60)
    nixpi.wait_until_succeeds("curl -sf http://127.0.0.1 | grep -q 'NixPI Home'", timeout=60)
    nixpi.wait_until_succeeds("curl -sf http://127.0.0.1 | grep -q 'Recovery'", timeout=60)
    nixpi.wait_until_succeeds("curl -sf http://127.0.0.1:8081/config.json | grep -q 'default_server_config'", timeout=60)
    nixpi.wait_until_succeeds("curl -skf https://127.0.0.1/ | grep -q 'NixPI Home'", timeout=60)
    nixpi.wait_until_succeeds("curl -skf https://127.0.0.1/element/config.json | grep -q 'default_server_config'", timeout=60)
    nixpi.wait_until_succeeds("curl -skf https://127.0.0.1/_matrix/client/versions | grep -q 'versions'", timeout=60)
    nixpi.wait_until_succeeds("curl -skf https://127.0.0.1/.well-known/matrix/client | grep -q 'm.homeserver'", timeout=60)
    nixpi.fail("grep -q 'CHAT_URL' /etc/system-services/nixpi-home/webroot/index.html")

    print("NixPI Home and Element Web tests passed!")
  '';
}
