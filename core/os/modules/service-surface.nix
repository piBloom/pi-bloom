{ pkgs, lib, config, ... }:

let
  resolved = import ../lib/resolve-primary-user.nix { inherit lib config; };
  primaryUser = resolved.resolvedPrimaryUser;
  stateDir = config.nixpi.stateDir;
  cfg = config.nixpi.services;
  securityCfg = config.nixpi.security;
in
{
  imports = [ ./options.nix ];

  config.system.services = lib.mkMerge [
    (lib.mkIf cfg.home.enable {
      nixpi-home = {
        imports = [ (lib.modules.importApply ../services/nixpi-home.nix { inherit pkgs; }) ];
        nixpi-home = {
          port = cfg.home.port;
          bindAddress = cfg.bindAddress;
          inherit stateDir;
          serviceUser = primaryUser;
          elementWebPort = cfg.elementWeb.port;
          matrixPort = config.nixpi.matrix.port;
          matrixClientBaseUrl =
            if config.nixpi.matrix.clientBaseUrl != "" then
              config.nixpi.matrix.clientBaseUrl
            else
              "http://${config.networking.hostName}:${toString config.nixpi.matrix.port}";
          trustedInterface = securityCfg.trustedInterface;
        };
      };
    })
    (lib.mkIf cfg.elementWeb.enable {
      nixpi-element-web = {
        imports = [ (lib.modules.importApply ../services/nixpi-element-web.nix { inherit pkgs; }) ];
        nixpi-element-web = {
          port = cfg.elementWeb.port;
          bindAddress = cfg.bindAddress;
          matrixServerName = config.networking.hostName;
          matrixClientBaseUrl =
            if config.nixpi.matrix.clientBaseUrl != "" then
              config.nixpi.matrix.clientBaseUrl
            else
              "http://${config.networking.hostName}:${toString config.nixpi.matrix.port}";
          inherit stateDir;
          serviceUser = primaryUser;
        };
      };
    })
  ];
}
