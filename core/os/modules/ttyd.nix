# core/os/modules/ttyd.nix
# Runs ttyd as a local service so the web terminal is available at /terminal.
# The nginx proxy in service-surface.nix exposes it on the public port.
{ pkgs, lib, config, ... }:

{
  options.nixpi.ttyd.enable = lib.mkEnableOption "web terminal via ttyd" // {
    default = true;
  };

  config = lib.mkIf config.nixpi.ttyd.enable {
    environment.systemPackages = [ pkgs.ttyd ];

    systemd.services.nixpi-ttyd = {
      description = "NixPI web terminal (ttyd)";
      after = [ "network.target" ];
      wantedBy = [ "multi-user.target" ];
      serviceConfig = {
        ExecStart = "${pkgs.ttyd}/bin/ttyd --writable --port 7681 --interface 127.0.0.1 ${pkgs.bash}/bin/bash";
        User = config.nixpi.primaryUser;
        Group = config.nixpi.primaryUser;
        Restart = "on-failure";
        RestartSec = "5";
        NoNewPrivileges = true;
        PrivateTmp = true;
      };
    };
  };
}
