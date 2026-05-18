{
  inputs,
  lib,
  pkgs,
  ...
}:
let
  exposure = import ../../fleet/exposure.nix;
  dashboard = exposure.host.hermesDashboard or { };

  enable = dashboard.enable or false;
  port = dashboard.port or 9119;
  hermes = inputs.hermes-agent.packages.${pkgs.stdenv.hostPlatform.system}.default;
  launcher = pkgs.writeShellScript "hermes-dashboard-start" ''
    set -euo pipefail

    exec ${hermes}/bin/hermes dashboard \
      --host 127.0.0.1 \
      --port ${toString port} \
      --no-open \
      --tui \
      --skip-build
  '';
in
{
  systemd.services.hermes-dashboard = lib.mkIf enable {
    description = "Hermes Agent Web Dashboard";
    wantedBy = [ "multi-user.target" ];
    unitConfig.StartLimitIntervalSec = 0;
    wants = [
      "hermes-agent.service"
      "network-online.target"
    ];
    after = [
      "network-online.target"
      "hermes-agent.service"
    ];

    environment = {
      HOME = "/var/lib/hermes";
      HERMES_HOME = "/var/lib/hermes/.hermes";
      HERMES_CONFIG_PATH = "/var/lib/hermes/.hermes/config.yaml";
      HERMES_DASHBOARD_TUI = "1";
      NIX_CONFIG = "experimental-features = nix-command flakes";
      PYTHONUNBUFFERED = "1";
    };

    path = with pkgs; [
      bashInteractive
      coreutils
      curl
      fd
      git
      hermes
      jq
      nix
      nixfmt
      nodejs_22
      openssh
      python3
      ripgrep
    ];

    serviceConfig = {
      Type = "simple";
      User = "alex";
      Group = "users";
      WorkingDirectory = "/var/lib/hermes";
      EnvironmentFile = [
        "-/var/lib/hermes/env"
        "-/var/lib/hermes/.hermes/.env"
      ];
      ExecStart = launcher;
      Restart = "always";
      RestartSec = "5s";

      NoNewPrivileges = true;
      PrivateTmp = true;
      ProtectSystem = "strict";
      ReadWritePaths = [
        "/var/lib/hermes"
        "/home/alex"
        "/srv/life"
      ];
      StateDirectory = [ "hermes" ];
      StateDirectoryMode = "0750";
      UMask = "0077";
    };
  };

  systemd.tmpfiles.rules = lib.mkIf enable [
    "d /var/lib/hermes 0750 alex users - -"
    "d /var/lib/hermes/.hermes 0750 alex users - -"
    "d /var/lib/hermes/workspace 0750 alex users - -"
    "z /var/lib/hermes 0750 alex users - -"
    "z /var/lib/hermes/.hermes 0750 alex users - -"
    "z /var/lib/hermes/workspace 0750 alex users - -"
  ];
}
