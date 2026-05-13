{ fleet, pkgs, ... }:
let
  git = fleet.vms.git;
  davServer = fleet.vms."dav-server";
  wireguardIp = "10.44.0.1";
in
{
  services.nginx = {
    enable = true;
    recommendedGzipSettings = true;
    recommendedOptimisation = true;
    recommendedProxySettings = true;

    virtualHosts.${git.dns} = {
      listen = [
        {
          addr = wireguardIp;
          port = 80;
        }
      ];
      locations."/" = {
        proxyPass = "http://${git.ip}:${toString git.webPort}";
        proxyWebsockets = true;
      };
    };

    virtualHosts.${davServer.dns} = {
      listen = [
        {
          addr = wireguardIp;
          port = 80;
        }
      ];
      locations."/" = {
        proxyPass = "http://${davServer.ip}:${toString davServer.davServer.httpPort}";
        proxyWebsockets = true;
      };
    };
  };

  systemd.services.nginx = {
    after = [
      "wireguard-wg0.service"
      "microvm@git.service"
      "microvm@dav-server.service"
    ];
    wants = [ "wireguard-wg0.service" ];
  };

  systemd.services.git-ssh-proxy = {
    description = "Private Forgejo Git SSH proxy to the git MicroVM";
    after = [
      "network-online.target"
      "wireguard-wg0.service"
      "microvm@git.service"
    ];
    wants = [
      "network-online.target"
      "wireguard-wg0.service"
      "microvm@git.service"
    ];
    wantedBy = [ "multi-user.target" ];
    path = [ pkgs.socat ];
    serviceConfig = {
      ExecStart = "${pkgs.socat}/bin/socat TCP-LISTEN:${toString git.sshPort},bind=${wireguardIp},reuseaddr,fork TCP:${git.ip}:${toString git.sshPort}";
      Restart = "always";
      RestartSec = "5s";
    };
  };

  networking.firewall.interfaces.wg0.allowedTCPPorts = [
    80
    git.sshPort
  ];
}
