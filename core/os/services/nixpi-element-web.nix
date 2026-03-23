{ pkgs }:

{ config, lib, ... }:

let
  inherit (lib) mkOption types;
  configJsonText = builtins.toJSON {
    default_server_config = {
      "m.homeserver" = {
        base_url = config.nixpi-element-web.matrixClientBaseUrl;
        server_name = config.nixpi-element-web.matrixServerName;
      };
    };
    disable_custom_urls = false;
    disable_guests = true;
    disable_3pid_login = false;
    brand = "Element";
    default_theme = "light";
    show_labs_settings = false;
    features = {};
  };
  configJson = pkgs.writeText "nixpi-element-web-config.json" configJsonText;
  webroot = pkgs.runCommandLocal "nixpi-element-web-root" {} ''
    mkdir -p "$out"
    ln -s ${pkgs.element-web}/* "$out/"
    rm "$out/config.json"
    cp ${configJson} "$out/config.json"
  '';
in
{
  _class = "service";

  options.nixpi-element-web = {
    port = mkOption {
      type = types.port;
    };

    bindAddress = mkOption {
      type = types.str;
    };

    matrixClientBaseUrl = mkOption {
      type = types.str;
    };

    matrixServerName = mkOption {
      type = types.str;
    };

    primaryUser = mkOption {
      type = types.str;
    };
  };

  config = {
    process.argv = [
      "${pkgs.static-web-server}/bin/static-web-server"
      "--host"
      config.nixpi-element-web.bindAddress
      "--port"
      (toString config.nixpi-element-web.port)
      "--root"
      webroot
      "--page-fallback"
      "${webroot}/index.html"
      "--health"
    ];

    configData = {
      "config.json".text = configJsonText;
    };

    systemd.service = {
      description = "NixPI Element Web client";
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      wantedBy = [ "multi-user.target" ];
      serviceConfig = {
        User = config.nixpi-element-web.primaryUser;
        Group = config.nixpi-element-web.primaryUser;
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
