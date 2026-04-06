{ config, pkgs, lib, ... }:

let
  primaryUser = config.nixpi.primaryUser;
  primaryHome = "/home/${primaryUser}";
  stateDir = config.nixpi.stateDir;
  systemReadyFile = "${primaryHome}/.nixpi/wizard-state/system-ready";
  bootstrapPrimaryPasswordFile = "${stateDir}/bootstrap/primary-user-password";
  hostFlakeInitializer = "${../../../scripts/nixpi-init-host-flake.sh}";

  # Single dispatcher for all bootstrap-guarded operations.
  # All subcommands check the system-ready marker and exit 1 if setup is complete.
  nixpiBootstrap = pkgs.writeShellScriptBin "nixpi-bootstrap" ''
    set -euo pipefail

    if [ -f "${systemReadyFile}" ]; then
      echo "NixPI bootstrap access is disabled after setup completes" >&2
      exit 1
    fi

    cmd="''${1:-}"
    shift || true

    case "$cmd" in
      read-primary-password)
        exec /run/current-system/sw/bin/sh -c 'tr -d "\n" < ${bootstrapPrimaryPasswordFile}'
        ;;
      remove-primary-password)
        exec /run/current-system/sw/bin/rm -f "${bootstrapPrimaryPasswordFile}"
        ;;
      netbird-up)
        exec /run/current-system/sw/bin/netbird up "$@"
        ;;
      netbird-systemctl|service-systemctl|sshd-systemctl)
        exec /run/current-system/sw/bin/systemctl "$@"
        ;;
      passwd)
        exec /run/current-system/sw/bin/passwd ${primaryUser} "$@"
        ;;
      chpasswd)
        exec /run/current-system/sw/bin/chpasswd "$@"
        ;;
      brokerctl)
        exec /run/current-system/sw/bin/nixpi-brokerctl "$@"
        ;;
      write-host-nix)
        hostname="''${1:-}"
        primary_user="''${2:-}"
        tz="''${3:-}"
        kb="''${4:-}"
        if [ -z "$hostname" ] || [ -z "$primary_user" ] || [ -z "$tz" ] || [ -z "$kb" ]; then
          echo "usage: nixpi-bootstrap write-host-nix <hostname> <primary_user> <timezone> <keyboard>" >&2
          exit 1
        fi
        if ! printf '%s' "$tz" | grep -qE '^[A-Za-z0-9_+/.-]{1,64}$'; then
          echo "invalid timezone: $tz" >&2
          exit 1
        fi
        if ! printf '%s' "$kb" | grep -qE '^[a-zA-Z0-9_-]{1,32}$'; then
          echo "invalid keyboard layout: $kb" >&2
          exit 1
        fi
        exec /run/current-system/sw/bin/bash ${hostFlakeInitializer} \
          /srv/nixpi "$hostname" "$primary_user" "$tz" "$kb"
        ;;
      *)
        echo "usage: nixpi-bootstrap <read-primary-password|remove-primary-password|netbird-up|netbird-systemctl|service-systemctl|sshd-systemctl|passwd|chpasswd|brokerctl|write-host-nix> [args...]" >&2
        exit 1
        ;;
    esac
  '';

  # Finalize wrapper: runs systemctl without the bootstrap guard.
  # Used after system-ready is set to enable/restart services at the end of setup.
  nixpiFinalize = pkgs.writeShellScriptBin "nixpi-finalize" ''
    exec /run/current-system/sw/bin/systemctl "$@"
  '';
in
{
  imports = [ ../options.nix ];

  environment.systemPackages = [
    nixpiBootstrap
    nixpiFinalize
  ];

  security.sudo.extraRules = lib.optional config.nixpi.bootstrap.passwordlessSudo.enable {
    users = [ primaryUser ];
    commands = [
      { command = "/run/current-system/sw/bin/nixpi-bootstrap read-primary-password"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap remove-primary-password"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap netbird-up --setup-key *"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap netbird-systemctl * netbird.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap service-systemctl restart nixpi-chat.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap service-systemctl start display-manager.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-finalize enable nixpi-chat.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-finalize restart nixpi-chat.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-finalize start display-manager.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap sshd-systemctl stop sshd.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap passwd"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap chpasswd"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap brokerctl systemd *"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap brokerctl status"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap write-host-nix *"; options = [ "NOPASSWD" ]; }
    ];
  };
}
