# core/os/modules/ttyd.nix
# Runs ttyd as a local service so the Pi terminal is available from the browser.
{ pkgs, lib, config, ... }:

let
  terminalBootstrap = pkgs.callPackage ../pkgs/nixpi-terminal-bootstrap { };
  primaryUser = config.nixpi.primaryUser;
  primaryHome = "/home/${primaryUser}";
in
{
  options.nixpi.ttyd.enable = lib.mkEnableOption "web terminal via ttyd" // {
    default = true;
  };

  config = lib.mkIf config.nixpi.ttyd.enable {
    environment.systemPackages = [ pkgs.ttyd ];

    systemd.services.nixpi-ttyd = {
      description = "NixPI web terminal (ttyd)";
      after = [ "network.target" "nixpi-app-setup.service" ];
      wants = [ "nixpi-app-setup.service" ];
      wantedBy = [ "multi-user.target" ];
      serviceConfig = {
        Environment = [
          "HOME=${primaryHome}"
          "NIXPI_PRIMARY_USER=${primaryUser}"
          "NIXPI_WORKSPACE_DIR=${config.nixpi.agent.workspaceDir}"
        ];
        ExecStart = "${pkgs.ttyd}/bin/ttyd --writable --port 7681 --interface 127.0.0.1 ${terminalBootstrap}/bin/nixpi-terminal-bootstrap";
        User = primaryUser;
        Group = primaryUser;
        WorkingDirectory = primaryHome;
        Restart = "on-failure";
        RestartSec = "5";
        NoNewPrivileges = true;
        PrivateTmp = true;
      };
    };
  };
}
