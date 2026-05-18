{
  config,
  lib,
  ...
}:
let
  hostIdentity = import ../../fleet/host.nix;
  davServerContext = {
    hostname = "nazar";
    service = "dav-server";
    dns = "dav.nazar.studio";
    aliases = [ ];
    davServer = {
      listenAddress = hostIdentity.private.ip;
      nginxDefault = false;
      radicalePort = 5232;
      httpPort = 80;
      auth = {
        enable = true;
        realm = "Nazar DAV";
        htpasswdFile = "/persist/services/dav-server/data/secrets/dav-server-htpasswd";
      };
      stateDir = "/persist/services/dav-server/data";
      webdavRoot = "/persist/services/dav-server/data/webdav";
      radicaleStateDir = "/persist/services/dav-server/radicale";
    };
  };
in
{
  imports = [ ../../../services/dav-server/nix/modules/dav-server.nix ];

  _module.args.davServerContext = davServerContext;

  systemd.tmpfiles.rules = [
    "d /persist/services/dav-server 0755 root root - -"
  ];

  system.activationScripts.nazar-dav-host-state = lib.stringAfter [ "users" ] ''
    set -euo pipefail

    state_dir=/persist/services/dav-server/data
    webdav_root=$state_dir/webdav
    secrets_dir=$state_dir/secrets
    htpasswd_file=$secrets_dir/dav-server-htpasswd
    radicale_dir=/persist/services/dav-server/radicale

    install -d -m 0750 -o nginx -g nginx "$state_dir" "$webdav_root" "$webdav_root/wiki" "$state_dir/nginx-client-body"
    install -d -m 0750 -o root -g nginx "$secrets_dir"
    install -d -m 0750 -o radicale -g radicale "$radicale_dir"

    if [ -d "$webdav_root" ]; then
      chown -R nginx:nginx "$webdav_root" "$state_dir/nginx-client-body"
      chmod 0750 "$webdav_root" "$state_dir/nginx-client-body"
    fi

    if [ -d "$radicale_dir" ]; then
      chown -R radicale:radicale "$radicale_dir"
      chmod 0750 "$radicale_dir"
    fi

    if [ -e "$htpasswd_file" ]; then
      chown root:nginx "$htpasswd_file"
      chmod 0640 "$htpasswd_file"
    else
      echo "warning: DAV auth file missing: $htpasswd_file" >&2
    fi
  '';

  assertions = [
    {
      assertion = lib.any (listen: listen.addr == hostIdentity.private.ip && listen.port == 80) (
        config.services.nginx.virtualHosts."dav.nazar.studio".listen or [ ]
      );
      message = "DAV host service must listen on the Nazar private address only.";
    }
  ];
}
