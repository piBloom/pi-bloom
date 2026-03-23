{ pkgs }:

{ config, lib, ... }:

let
  inherit (lib) mkOption types;
  webroot = builtins.dirOf config.configData."webroot/index.html".path;
in
{
  _class = "service";

  options.nixpi-home = {
    port = mkOption {
      type = types.port;
    };

    bindAddress = mkOption {
      type = types.str;
    };

    primaryUser = mkOption {
      type = types.str;
    };

    elementWebPort = mkOption {
      type = types.port;
    };

    matrixPort = mkOption {
      type = types.port;
    };

    matrixClientBaseUrl = mkOption {
      type = types.str;
    };

    trustedInterface = mkOption {
      type = types.str;
    };
  };

  config = {
    process.argv = [
      "${pkgs.static-web-server}/bin/static-web-server"
      "--host"
      config.nixpi-home.bindAddress
      "--port"
      (toString config.nixpi-home.port)
      "--root"
      webroot
      "--health"
    ];

    configData = {
      "webroot/index.html".text = ''
        <!doctype html>
        <html lang="en">
        <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NixPI Home</title></head>
        <body>
          <h1>NixPI Home</h1>
          <p>Primary interfaces: terminal, Matrix, and Element Web.</p>
          <h2>Local access</h2>
          <ul>
            <li>Home: <a href="http://localhost:${toString config.nixpi-home.port}">http://localhost:${toString config.nixpi-home.port}</a></li>
            <li>Element Web: <a href="http://localhost:${toString config.nixpi-home.elementWebPort}">http://localhost:${toString config.nixpi-home.elementWebPort}</a></li>
            <li>Matrix: <a href="http://localhost:${toString config.nixpi-home.matrixPort}">http://localhost:${toString config.nixpi-home.matrixPort}</a></li>
          </ul>
          <h2>Remote access</h2>
          <p>Use your NetBird hostname or mesh IP on interface ${config.nixpi-home.trustedInterface}. Home is available on the bare HTTP address; Element Web and Matrix keep their explicit ports.</p>
          <ul>
            <li>Home: http://&lt;netbird-hostname-or-mesh-ip&gt;/</li>
            <li>Home direct port: ${toString config.nixpi-home.port}</li>
            <li>Element Web: ${toString config.nixpi-home.elementWebPort}</li>
            <li>Matrix URL: ${config.nixpi-home.matrixClientBaseUrl}</li>
          </ul>
        </body>
        </html>
      '';
    };

    systemd.service = {
      description = "NixPI Home landing page";
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      wantedBy = [ "multi-user.target" ];
      serviceConfig = {
        User = config.nixpi-home.primaryUser;
        Group = config.nixpi-home.primaryUser;
        UMask = "0007";
        Restart = "on-failure";
        RestartSec = "10";
        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectSystem = "strict";
        ProtectHome = false;
      };
    };
  };
}
