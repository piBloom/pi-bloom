{
  lib,
  nixPiModulesNoShell,
  mkTestFilesystems,
  ...
}:

let
  serverPrivateKey = "uPbvKLtD35jbnOdhLUd3+qjEobT1cq0qHPt8KZ+RFmY=";
  serverPublicKey = "kL+fxoDdjLV9d7Br2Ic8oGLCuhVAqP1GOgHYNAZ/lBc=";
  clientPrivateKey = "GFsSi1hbQDbwgpQDI4o/gi+jhh4CNTI4gfTp+RCSCE0=";
  clientPublicKey = "24kILIZLwbEGAMV6JP7siP9Rg2DR6QMJjSdPSl7F8i0=";
  presharedKey = "KJduqkMXVQ9l0Iz7JsLzuhkD1zTJ9ECyC3HVB6T3G10=";
  initSystemFlake = ../../core/scripts/nixpi-init-system-flake.sh;
in
{
  name = "nixpi-wireguard";

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
        nixpi.wireguard = {
          privateKeyFile = "/run/wireguard/server.key";
          generatePrivateKeyFile = false;
          peers = [
            {
              name = "client";
              publicKey = clientPublicKey;
              allowedIPs = [ "10.77.0.2/32" ];
              presharedKeyFile = "/run/wireguard/psk";
            }
          ];
        };

        virtualisation.diskSize = 20480;
        virtualisation.memorySize = 4096;

        networking.hostName = "nixpi";
        networking.networkmanager.enable = lib.mkForce false;
        time.timeZone = "UTC";
        i18n.defaultLocale = "en_US.UTF-8";
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

        environment.etc = {
          "wireguard/server.key".text = serverPrivateKey;
          "wireguard/psk".text = presharedKey;
        };
        systemd.tmpfiles.rules = [
          "d /run/wireguard 0700 root root -"
          "C /run/wireguard/server.key 0600 root root - /etc/wireguard/server.key"
          "C /run/wireguard/psk 0600 root root - /etc/wireguard/psk"
          "d ${homeDir}/.nixpi 0755 ${username} ${username} -"
        ];
        systemd.services.nixpi-prefer-wifi.enable = lib.mkForce false;

        system.activationScripts.nixpi-wireguard-bootstrap = lib.stringAfter [ "users" ] ''
          mkdir -p ${homeDir}/.nixpi
          install -d -m 0755 /etc/nixos
          cat > /etc/nixos/configuration.nix <<'EOF'
          { ... }:
          {
            networking.hostName = "nixpi";
          }
          EOF
          cat > /etc/nixos/hardware-configuration.nix <<'EOF'
          { ... }:
          {}
          EOF
          ${lib.getExe' pkgs.bash "bash"} ${initSystemFlake} /srv/nixpi nixpi ${username} UTC us
          chown -R ${username}:${username} ${homeDir}/.nixpi
          chmod 755 ${homeDir}/.nixpi
        '';
      };

    client =
      { pkgs, ... }:
      {
        imports = [ mkTestFilesystems ];

        virtualisation.diskSize = 5120;
        virtualisation.memorySize = 1024;

        networking.hostName = "client";
        networking.networkmanager.enable = lib.mkForce false;
        time.timeZone = "UTC";
        i18n.defaultLocale = "en_US.UTF-8";
        networking.firewall.enable = true;
        system.stateVersion = "25.05";
        boot.loader.systemd-boot.enable = true;
        boot.loader.efi.canTouchEfiVariables = true;

        environment.systemPackages = with pkgs; [
          curl
          iproute2
          netcat
          wireguard-tools
        ];
        environment.etc = {
          "wireguard/client.key".text = clientPrivateKey;
          "wireguard/psk".text = presharedKey;
        };
        systemd.tmpfiles.rules = [
          "d /run/wireguard 0700 root root -"
          "C /run/wireguard/client.key 0600 root root - /etc/wireguard/client.key"
          "C /run/wireguard/psk 0600 root root - /etc/wireguard/psk"
        ];

        networking.wireguard.interfaces.wg0 = {
          ips = [ "10.77.0.2/32" ];
          privateKeyFile = "/run/wireguard/client.key";
          listenPort = 51821;
          peers = [
            {
              name = "nixpi";
              publicKey = serverPublicKey;
              allowedIPs = [ "10.77.0.1/32" ];
              endpoint = "192.168.1.2:51820";
              persistentKeepalive = 25;
              presharedKeyFile = "/run/wireguard/psk";
            }
          ];
        };
      };
  };

  testScript = ''
    client = machines[0]
    nixpi = machines[1]

    nixpi.start()
    nixpi.wait_for_unit("multi-user.target", timeout=300)
    nixpi.wait_for_unit("wireguard-wg0.service", timeout=120)
    nixpi.wait_for_unit("nginx.service", timeout=120)
    nixpi.wait_until_succeeds("curl -sf http://127.0.0.1/ | grep -q 'nixpi-shell'", timeout=60)

    client.start()
    client.wait_for_unit("multi-user.target", timeout=120)
    client.wait_for_unit("wireguard-wg0.service", timeout=120)

    client.wait_until_succeeds("ping -n -w 1 -c 1 10.77.0.1", timeout=120)
    nixpi.wait_until_succeeds("ping -n -w 1 -c 1 10.77.0.2", timeout=120)

    client.succeed("nc -z -w 2 10.77.0.1 443")
    client.succeed("curl -kfsS https://10.77.0.1/ | grep -q 'nixpi-shell'")

    for port in [80, 443, 8080]:
        client.succeed(f"! nc -z -w 2 nixpi {port}")

    print("NixPI WireGuard access test passed!")
  '';
}
