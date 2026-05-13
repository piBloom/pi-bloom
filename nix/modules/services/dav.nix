{
  lib,
  pkgs,
  vm,
  ...
}:
let
  cfg = vm.dav;
in
{
  fileSystems."/" = {
    device = lib.mkDefault "tmpfs";
    fsType = lib.mkDefault "tmpfs";
    options = lib.mkDefault [
      "size=2G"
      "mode=755"
    ];
  };

  system.stateVersion = "26.05";

  services.radicale = {
    enable = true;
    settings = {
      server = {
        hosts = [ "127.0.0.1:${toString cfg.radicalePort}" ];
      };
      auth = {
        type = "none";
      };
      storage = {
        filesystem_folder = cfg.radicaleStateDir;
      };
    };
  };

  services.nginx = {
    enable = true;
    virtualHosts.${cfg.domain} = {
      listen = [
        {
          addr = "0.0.0.0";
          port = cfg.httpPort;
        }
      ];
      locations."/".return = "200 'Nazar DAV VM\n/files/ WebDAV\n/radicale/ CalDAV/CardDAV\n'";
      locations."/files/" = {
        root = cfg.stateDir;
        basicAuthFile = lib.mkIf (cfg.auth.enable or false) cfg.auth.htpasswdFile;
        extraConfig = ''
          dav_methods PUT DELETE MKCOL COPY MOVE;
          dav_ext_methods PROPFIND OPTIONS;
          create_full_put_path on;
          dav_access user:rw group:rw all:r;
          autoindex on;
          client_body_temp_path ${cfg.stateDir}/nginx-client-body;
        '';
      };
      locations."/radicale/" = {
        proxyPass = "http://127.0.0.1:${toString cfg.radicalePort}/";
        basicAuthFile = lib.mkIf (cfg.auth.enable or false) cfg.auth.htpasswdFile;
        extraConfig = ''
          proxy_set_header X-Script-Name /radicale;
          proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
          proxy_set_header X-Forwarded-Proto $scheme;
          proxy_set_header Host $host;
        '';
      };
    };
  };

  systemd.tmpfiles.rules = [
    "d ${cfg.stateDir} 0750 nginx nginx - -"
    "d ${cfg.webdavRoot} 0750 nginx nginx - -"
    "d ${cfg.radicaleStateDir} 0750 radicale radicale - -"
    "d ${cfg.stateDir}/nginx-client-body 0750 nginx nginx - -"
  ];

  networking.firewall.allowedTCPPorts = [ cfg.httpPort ];

  assertions = [
    {
      assertion = cfg.httpPort == 80;
      message = "DAV VM currently expects HTTP port 80 behind private WireGuard/Nazar routing.";
    }
  ];
}
