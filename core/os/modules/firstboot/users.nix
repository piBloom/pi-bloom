{ config, pkgs, lib, ... }:

let
  primaryUser = config.nixpi.primaryUser;
  primaryHome = "/home/${primaryUser}";
  stateDir = config.nixpi.stateDir;
  netbirdApiTokenFile =
    if config.nixpi.netbird.apiTokenFile != null then
      config.nixpi.netbird.apiTokenFile
    else
      "${stateDir}/netbird-api-token";
  systemReadyFile = "${primaryHome}/.nixpi/wizard-state/system-ready";
  matrixRegistrationSecretFile =
    if config.nixpi.matrix.registrationSharedSecretFile != null then
      config.nixpi.matrix.registrationSharedSecretFile
    else
      "${stateDir}/secrets/matrix-registration-shared-secret";
  bootstrapPrimaryPasswordFile = "${stateDir}/bootstrap/primary-user-password";

  bootstrapReadMatrixSecret = pkgs.writeShellScriptBin "nixpi-bootstrap-read-matrix-secret" ''
    set -euo pipefail
    if [ -f "${systemReadyFile}" ]; then
      echo "NixPI bootstrap access is disabled after setup completes" >&2
      exit 1
    fi
    exec /run/current-system/sw/bin/sh -c 'tr -d "\n" < ${matrixRegistrationSecretFile}' "$@"
  '';

  bootstrapReadPrimaryPassword = pkgs.writeShellScriptBin "nixpi-bootstrap-read-primary-password" ''
    set -euo pipefail
    if [ -f "${systemReadyFile}" ]; then
      echo "NixPI bootstrap access is disabled after setup completes" >&2
      exit 1
    fi
    exec /run/current-system/sw/bin/sh -c 'tr -d "\n" < ${bootstrapPrimaryPasswordFile}' "$@"
  '';

  bootstrapRemovePrimaryPassword = pkgs.writeShellScriptBin "nixpi-bootstrap-remove-primary-password" ''
    set -euo pipefail
    if [ -f "${systemReadyFile}" ]; then
      echo "NixPI bootstrap access is disabled after setup completes" >&2
      exit 1
    fi
    exec /run/current-system/sw/bin/rm -f ${bootstrapPrimaryPasswordFile} "$@"
  '';

  bootstrapMatrixJournal = pkgs.writeShellScriptBin "nixpi-bootstrap-matrix-journal" ''
    set -euo pipefail
    if [ -f "${systemReadyFile}" ]; then
      echo "NixPI bootstrap access is disabled after setup completes" >&2
      exit 1
    fi
    exec /run/current-system/sw/bin/journalctl -u continuwuity --no-pager "$@"
  '';

  bootstrapNetbird = pkgs.writeShellScriptBin "nixpi-bootstrap-netbird-up" ''
    set -euo pipefail
    if [ -f "${systemReadyFile}" ]; then
      echo "NixPI bootstrap access is disabled after setup completes" >&2
      exit 1
    fi
    exec /run/current-system/sw/bin/netbird up "$@"
  '';

  bootstrapNetbirdProvisioner = pkgs.writeShellScriptBin "nixpi-bootstrap-netbird-provisioner" ''
    set -euo pipefail
    if [ -f "${systemReadyFile}" ]; then
      echo "NixPI bootstrap access is disabled after setup completes" >&2
      exit 1
    fi

    if [ "''${1:-}" = "start" ] && [ "''${2:-}" = "nixpi-netbird-provisioner.service" ]; then
      /run/current-system/sw/bin/systemctl reset-failed nixpi-netbird-provisioner.service >/dev/null 2>&1 || true
      /run/current-system/sw/bin/journalctl -fu nixpi-netbird-provisioner.service --no-pager -n 0 &
      journal_pid=$!
      trap 'kill "$journal_pid" >/dev/null 2>&1 || true' EXIT
      /run/current-system/sw/bin/systemctl start nixpi-netbird-provisioner.service
      kill "$journal_pid" >/dev/null 2>&1 || true
      wait "$journal_pid" 2>/dev/null || true
      exit 0
    fi

    exec /run/current-system/sw/bin/systemctl "$@"
  '';

  bootstrapWriteNetbirdToken = pkgs.writeShellScriptBin "nixpi-bootstrap-write-netbird-token" ''
    set -euo pipefail
    if [ -f "${systemReadyFile}" ]; then
      echo "NixPI bootstrap access is disabled after setup completes" >&2
      exit 1
    fi

    token="''${1:-}"
    if [ -z "$token" ]; then
      echo "usage: nixpi-bootstrap-write-netbird-token <token>" >&2
      exit 1
    fi

    install -d -m 0770 -o ${primaryUser} -g ${primaryUser} "$(dirname "${netbirdApiTokenFile}")"
    printf '%s' "$token" > "${netbirdApiTokenFile}"
    chown ${primaryUser}:${primaryUser} "${netbirdApiTokenFile}"
    chmod 0600 "${netbirdApiTokenFile}"
    echo "NetBird API token saved."
  '';

  bootstrapCreateNetworkActivityRoom = pkgs.writeShellScriptBin "nixpi-bootstrap-create-network-activity-room" ''
    set -euo pipefail
    if [ -f "${systemReadyFile}" ]; then
      echo "NixPI bootstrap access is disabled after setup completes" >&2
      exit 1
    fi

    export WIZARD_STATE="${stateDir}/bootstrap/netbird-room"
    export MATRIX_STATE_DIR="${stateDir}/bootstrap/netbird-room-matrix-state"
    export MATRIX_HOMESERVER="http://127.0.0.1:${toString config.nixpi.matrix.port}"
    export PI_DIR="${primaryHome}/.pi"
    export NIXPI_CONFIG="${stateDir}/services"
    export NIXPI_DIR="${primaryHome}/nixpi"
    # shellcheck source=/run/current-system/sw/bin/setup-lib.sh
    source /run/current-system/sw/bin/setup-lib.sh

    if [ ! -f "${matrixRegistrationSecretFile}" ]; then
      echo "Matrix registration secret not found; skipping network activity room bootstrap." >&2
      exit 0
    fi

    registration_token="$(tr -d '\n' < "${matrixRegistrationSecretFile}")"
    watcher_dir="${stateDir}/netbird-watcher"
    password_file="$watcher_dir/matrix-password"
    token_file="$watcher_dir/matrix-token"
    bot_username="netbird-watcher"
    room_alias="network-activity"
    room_path="%23''${room_alias}%3A${config.networking.hostName}"

    install -d -m 0770 -o ${primaryUser} -g ${primaryUser} "$watcher_dir" "$WIZARD_STATE" "$MATRIX_STATE_DIR"

    if [ -f "$password_file" ]; then
      bot_password="$(tr -d '\n' < "$password_file")"
    else
      bot_password="$(generate_password)"
      printf '%s' "$bot_password" > "$password_file"
      chown ${primaryUser}:${primaryUser} "$password_file"
      chmod 0600 "$password_file"
    fi

    bot_result="$(matrix_login "$bot_username" "$bot_password" 2>/dev/null || true)"
    if [ -z "$bot_result" ]; then
      bot_result="$(matrix_register "$bot_username" "$bot_password" "$registration_token" 2>/dev/null || true)"
    fi
    if [ -z "$bot_result" ]; then
      echo "Failed to create or log into @''${bot_username}:${config.networking.hostName}" >&2
      exit 1
    fi

    access_token="$(printf '%s' "$bot_result" | ${pkgs.jq}/bin/jq -r '.access_token // empty')"
    if [ -z "$access_token" ]; then
      echo "Matrix login for @''${bot_username}:${config.networking.hostName} did not return an access token" >&2
      exit 1
    fi

    printf '%s' "$access_token" > "$token_file"
    chown ${primaryUser}:${primaryUser} "$token_file"
    chmod 0600 "$token_file"

    if ! ${pkgs.curl}/bin/curl -sf "''${MATRIX_HOMESERVER}/_matrix/client/v3/directory/room/$room_path" >/dev/null 2>&1; then
      ${pkgs.curl}/bin/curl -sf -X POST "''${MATRIX_HOMESERVER}/_matrix/client/v3/createRoom" \
        -H "Authorization: Bearer $access_token" \
        -H "Content-Type: application/json" \
        -d '{"room_alias_name":"network-activity","name":"Network Activity","topic":"NetBird peer connection events","preset":"private_chat"}' \
        >/dev/null
    fi

    rm -rf "$WIZARD_STATE" "$MATRIX_STATE_DIR"

    echo "Network activity room created: #network-activity:${config.networking.hostName}"
    echo "Future peer connections, logins, and policy changes will appear there."
  '';

  bootstrapNetbirdSystemctl = pkgs.writeShellScriptBin "nixpi-bootstrap-netbird-systemctl" ''
    set -euo pipefail
    if [ -f "${systemReadyFile}" ]; then
      echo "NixPI bootstrap access is disabled after setup completes" >&2
      exit 1
    fi
    exec /run/current-system/sw/bin/systemctl "$@"
  '';

  bootstrapMatrixSystemctl = pkgs.writeShellScriptBin "nixpi-bootstrap-matrix-systemctl" ''
    set -euo pipefail
    if [ -f "${systemReadyFile}" ]; then
      echo "NixPI bootstrap access is disabled after setup completes" >&2
      exit 1
    fi
    exec /run/current-system/sw/bin/systemctl "$@"
  '';

  bootstrapServiceSystemctl = pkgs.writeShellScriptBin "nixpi-bootstrap-service-systemctl" ''
    set -euo pipefail
    if [ -f "${systemReadyFile}" ]; then
      echo "NixPI bootstrap access is disabled after setup completes" >&2
      exit 1
    fi
    exec /run/current-system/sw/bin/systemctl "$@"
  '';

  finalizeServiceSystemctl = pkgs.writeShellScriptBin "nixpi-finalize-service-systemctl" ''
    set -euo pipefail
    exec /run/current-system/sw/bin/systemctl "$@"
  '';

  bootstrapSshdSystemctl = pkgs.writeShellScriptBin "nixpi-bootstrap-sshd-systemctl" ''
    set -euo pipefail
    if [ -f "${systemReadyFile}" ]; then
      echo "NixPI bootstrap access is disabled after setup completes" >&2
      exit 1
    fi
    exec /run/current-system/sw/bin/systemctl "$@"
  '';

  bootstrapPasswd = pkgs.writeShellScriptBin "nixpi-bootstrap-passwd" ''
    set -euo pipefail
    if [ -f "${systemReadyFile}" ]; then
      echo "NixPI bootstrap access is disabled after setup completes" >&2
      exit 1
    fi
    exec /run/current-system/sw/bin/passwd ${primaryUser} "$@"
  '';

  bootstrapChpasswd = pkgs.writeShellScriptBin "nixpi-bootstrap-chpasswd" ''
    set -euo pipefail
    if [ -f "${systemReadyFile}" ]; then
      echo "NixPI bootstrap access is disabled after setup completes" >&2
      exit 1
    fi
    exec /run/current-system/sw/bin/chpasswd "$@"
  '';

  bootstrapBroker = pkgs.writeShellScriptBin "nixpi-bootstrap-brokerctl" ''
    set -euo pipefail
    if [ -f "${systemReadyFile}" ]; then
      echo "NixPI bootstrap access is disabled after setup completes" >&2
      exit 1
    fi
    exec /run/current-system/sw/bin/nixpi-brokerctl "$@"
  '';

  bootstrapWriteHostNix = pkgs.writeShellScriptBin "nixpi-bootstrap-write-host-nix" ''
    set -euo pipefail
    if [ -f "${systemReadyFile}" ]; then
      echo "NixPI bootstrap access is disabled after setup completes" >&2
      exit 1
    fi

    hostname="''${1:-}"
    primary_user="''${2:-}"
    tz="''${3:-}"
    kb="''${4:-}"
    if [ -z "$hostname" ] || [ -z "$primary_user" ] || [ -z "$tz" ] || [ -z "$kb" ]; then
      echo "usage: nixpi-bootstrap-write-host-nix <hostname> <primary_user> <timezone> <keyboard>" >&2
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

    install -d -m 0755 /etc/nixos
    cat > /etc/nixos/nixpi-host.nix <<EOF
{ ... }:
{
  networking.hostName = "$hostname";
  nixpi.primaryUser = "$primary_user";
  nixpi.timezone = "$tz";
  nixpi.keyboard = "$kb";
}
EOF
  '';

  bootstrapMatrixExecute = pkgs.writeShellScriptBin "nixpi-bootstrap-matrix-execute" ''
    set -euo pipefail
    if [ -f "${systemReadyFile}" ]; then
      echo "NixPI bootstrap access is disabled after setup completes" >&2
      exit 1
    fi

    command_string="''${1:-}"
    if [ -z "$command_string" ]; then
      echo "usage: nixpi-bootstrap-matrix-execute '<admin command>'" >&2
      exit 1
    fi

    binary="$(${pkgs.systemd}/bin/systemctl cat continuwuity.service | ${pkgs.gnused}/bin/sed -n 's/^ExecStart=\([^[:space:]]*\).*/\1/p' | ${pkgs.coreutils}/bin/head -n 1)"
    if [ -z "$binary" ] || [ ! -x "$binary" ]; then
      echo "Could not determine the Continuwuity binary path from continuwuity.service" >&2
      exit 1
    fi

    set +e
    ${pkgs.coreutils}/bin/env CONTINUWUITY_CONFIG=/var/lib/continuwuity/continuwuity.toml \
      ${pkgs.coreutils}/bin/timeout 15s "$binary" --execute "$command_string"
    status=$?
    set -e

    if [ "$status" -ne 0 ] && [ "$status" -ne 124 ] && [ "$status" -ne 137 ]; then
      exit "$status"
    fi
  '';
in
{
  imports = [ ../options.nix ];

  environment.systemPackages = [
    bootstrapReadMatrixSecret
    bootstrapReadPrimaryPassword
    bootstrapRemovePrimaryPassword
    bootstrapMatrixJournal
    bootstrapNetbird
    bootstrapNetbirdProvisioner
    bootstrapWriteNetbirdToken
    bootstrapCreateNetworkActivityRoom
    bootstrapNetbirdSystemctl
    bootstrapMatrixSystemctl
    bootstrapServiceSystemctl
    finalizeServiceSystemctl
    bootstrapSshdSystemctl
    bootstrapPasswd
    bootstrapChpasswd
    bootstrapBroker
    bootstrapWriteHostNix
    bootstrapMatrixExecute
  ];

  security.sudo.extraRules = lib.optional config.nixpi.bootstrap.passwordlessSudo.enable {
    users = [ primaryUser ];
    commands = [
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-read-matrix-secret"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-read-primary-password"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-remove-primary-password"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-matrix-journal"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-matrix-systemctl stop continuwuity.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-matrix-systemctl start continuwuity.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-matrix-systemctl restart continuwuity.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-netbird-up --setup-key *"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-netbird-provisioner start nixpi-netbird-provisioner.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-write-netbird-token *"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-create-network-activity-room"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-netbird-systemctl * netbird.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-matrix-systemctl try-restart continuwuity.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-service-systemctl restart nixpi-home.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-service-systemctl restart nixpi-element-web.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-service-systemctl enable nixpi-daemon.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-service-systemctl restart nixpi-daemon.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-service-systemctl start display-manager.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-finalize-service-systemctl enable nixpi-daemon.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-finalize-service-systemctl restart nixpi-daemon.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-finalize-service-systemctl start display-manager.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-sshd-systemctl stop sshd.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-passwd"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-chpasswd"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-brokerctl systemd *"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-brokerctl status"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-matrix-execute *"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-write-host-nix *"; options = [ "NOPASSWD" ]; }
    ];
  };
}
