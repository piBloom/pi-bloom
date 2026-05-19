{
  config,
  lib,
  pkgs,
  ...
}:
{
  services.nginx = {
    enable = true;
    user = "alex";
    group = "users";
    recommendedOptimisation = true;
    recommendedProxySettings = true;
    recommendedTlsSettings = true;
    additionalModules = [ pkgs.nginxModules.dav ];

    virtualHosts."life-os-private" = {
      default = true;
      listen = [
        {
          addr = "0.0.0.0";
          port = 80;
        }
      ];

      locations."/life/" = {
        alias = "/srv/life/";
        extraConfig = ''
          dav_methods PUT DELETE MKCOL COPY MOVE;
          dav_ext_methods PROPFIND OPTIONS;
          create_full_put_path on;
          dav_access user:rw group:rw all:r;
          autoindex on;
        '';
      };
    };
  };

  systemd.tmpfiles.rules = [
    "d /var/lib/nginx 0750 alex users - -"
    "d /var/lib/nginx/client_body 0750 alex users - -"
  ];

  assertions = [
    {
      assertion = lib.elem 80 (config.networking.firewall.interfaces.tailscale0.allowedTCPPorts or [ ]);
      message = "Life OS WebDAV expects TCP/80 to be allowed on tailscale0 only.";
    }
  ];
}
