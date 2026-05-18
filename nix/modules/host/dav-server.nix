{
  config,
  lib,
  pkgs,
  ...
}:
let
  exposure = import ../../fleet/exposure.nix;
  hostIdentity = import ../../fleet/host.nix;
  dav = exposure.host.dav or { };

  enable = dav.enable or false;
  domain = dav.domain or "dav.nazar.studio";
  privateIp = hostIdentity.private.ip;

  stateDir = "/persist/services/dav-server";
  webdavRoot = "${stateDir}/webdav";
  radicaleStateDir = "${stateDir}/radicale";
  radicalePort = 5232;
in
{
  services.radicale = lib.mkIf enable {
    enable = true;
    settings = {
      server.hosts = [ "127.0.0.1:${toString radicalePort}" ];
      auth.type = "none";
      rights.type = "owner_only";
      storage.filesystem_folder = radicaleStateDir;
      web.type = "internal";
    };
  };

  services.nginx = lib.mkIf enable {
    enable = true;
    package = pkgs.nginxStable.override { modules = [ pkgs.nginxModules.dav ]; };
    recommendedOptimisation = true;

    virtualHosts.${domain} = {
      listen = [
        {
          addr = privateIp;
          port = 80;
        }
      ];

      locations."/".return =
        "200 'Nazar DAV: use /radicale/ for CalDAV/CardDAV and /files/ for WebDAV files.\n'";

      locations."/radicale/" = {
        proxyPass = "http://127.0.0.1:${toString radicalePort}/";
        extraConfig = ''
          proxy_set_header X-Script-Name /radicale;
          proxy_set_header Host $host;
          proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
          proxy_set_header X-Forwarded-Proto $scheme;
          proxy_pass_header Authorization;
        '';
      };

      locations."/files/".extraConfig = ''
        alias ${webdavRoot}/;
        autoindex on;

        dav_methods PUT DELETE MKCOL COPY MOVE;
        dav_ext_methods PROPFIND OPTIONS;
        create_full_put_path on;
        dav_access user:rw group:rw all:r;

        client_max_body_size 512m;
        client_body_temp_path ${stateDir}/nginx-client-body;
      '';
    };
  };

  systemd.tmpfiles.rules = lib.mkIf enable [
    "d ${stateDir} 0755 root root - -"
    "d ${webdavRoot} 0750 nginx nginx - -"
    "d ${webdavRoot}/wiki 0750 nginx nginx - -"
    "d ${stateDir}/nginx-client-body 0750 nginx nginx - -"
    "d ${radicaleStateDir} 0750 radicale radicale - -"
    "z ${stateDir} 0755 root root - -"
    "z ${webdavRoot} 0750 nginx nginx - -"
    "z ${stateDir}/nginx-client-body 0750 nginx nginx - -"
    "z ${radicaleStateDir} 0750 radicale radicale - -"
  ];

  assertions = lib.mkIf enable [
    {
      assertion = lib.any (listen: listen.addr == privateIp && listen.port == 80) (
        config.services.nginx.virtualHosts.${domain}.listen or [ ]
      );
      message = "DAV host service must listen on the Nazar private address only.";
    }
    {
      assertion = (dav.access or "private") == "private";
      message = "DAV must remain private-only behind sshuttle.";
    }
  ];
}
