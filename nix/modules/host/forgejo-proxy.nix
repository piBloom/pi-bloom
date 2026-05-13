{
  fleet,
  lib,
  pkgs,
  ...
}:
let
  git = fleet.vms.git;
  ownloom = fleet.vms.ownloom;
  davServer = fleet.vms."dav-server";
  wireguardIp = "10.44.0.1";
  hostNixpiDns = "nixpi.nazar.studio";
  hostNixpiPort = 4815;
  microvmUnits = map (name: "microvm@${name}.service") (lib.attrNames fleet.vms);
  mkNixpiVhost = proxyPass: {
    listen = [
      {
        addr = wireguardIp;
        port = 80;
      }
    ];
    locations."/" = {
      inherit proxyPass;
      proxyWebsockets = true;
      extraConfig = ''
        client_max_body_size 25m;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
      '';
    };
  };
  nixpiVirtualHosts = lib.mapAttrs' (
    _name: vm:
    lib.nameValuePair vm.nixpi.dns (mkNixpiVhost "http://${vm.ip}:${toString (vm.nixpi.port or 4815)}")
  ) fleet.vms;
in
{
  services.nginx = {
    enable = true;
    recommendedGzipSettings = true;
    recommendedOptimisation = true;
    recommendedProxySettings = true;

    virtualHosts = {
      ${git.dns} = {
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

      ${ownloom.dns} = {
        listen = [
          {
            addr = wireguardIp;
            port = 80;
          }
        ];
        locations."/" = {
          proxyPass = "http://${ownloom.ip}:${toString (ownloom.ownloom.web.httpPort or 80)}";
          proxyWebsockets = true;
        };
      };

      ${davServer.dns} = {
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

      ${hostNixpiDns} = mkNixpiVhost "http://127.0.0.1:${toString hostNixpiPort}";
    }
    // nixpiVirtualHosts;
  };

  systemd.services.nginx = {
    after = [
      "wireguard-wg0.service"
      "nixpi.service"
    ] ++ microvmUnits;
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
