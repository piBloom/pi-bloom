# core/os/modules/app.nix
{ pkgs, lib, appPackage, piAgent, ... }:

{
  environment.systemPackages = [ appPackage piAgent ];

  systemd.tmpfiles.rules = [
    "L+ /usr/local/share/workspace - - - - ${appPackage}/share/workspace"
    "d /etc/workspace/appservices 0755 root root -"
  ];

  systemd.user.services.pi-daemon = {
    description = "nixPI Pi Daemon (Matrix room agent)";
    wantedBy = [ "default.target" ];

    unitConfig.ConditionPathExists = "%h/.workspace/.setup-complete";

    serviceConfig = {
      Type       = "simple";
      ExecStart  = "${pkgs.nodejs}/bin/node /usr/local/share/workspace/dist/core/daemon/index.js";
      Environment = [
        "HOME=%h"
        "WORKSPACE_DIR=%h/Workspace"
        "PATH=${lib.makeBinPath [ piAgent pkgs.nodejs ]}:/run/current-system/sw/bin"
      ];
      Restart    = "on-failure";
      RestartSec = 15;
    };
  };
}
