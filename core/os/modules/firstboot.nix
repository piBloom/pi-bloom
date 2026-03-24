{ config, pkgs, lib, piAgent, appPackage, setupPackage, ... }:

let
  primaryUser = config.nixpi.primaryUser;
  primaryHome = "/home/${primaryUser}";
  canonicalRepoDir = "/srv/nixpi";
  canonicalRepoMetadataPath = "/etc/nixpi/canonical-repo.json";
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
  bootstrapAction = action: command: pkgs.writeShellScriptBin "nixpi-bootstrap-${action}" ''
    set -euo pipefail
    if [ -f "${systemReadyFile}" ]; then
      echo "NixPI bootstrap access is disabled after setup completes" >&2
      exit 1
    fi
    exec ${command} "$@"
  '';
  bootstrapReadMatrixSecret = bootstrapAction "read-matrix-secret" "/run/current-system/sw/bin/sh -c 'tr -d \"\\n\" < ${matrixRegistrationSecretFile}'";
  bootstrapReadPrimaryPassword = bootstrapAction "read-primary-password" "/run/current-system/sw/bin/sh -c 'tr -d \"\\n\" < ${bootstrapPrimaryPasswordFile}'";
  bootstrapRemovePrimaryPassword = bootstrapAction "remove-primary-password" "/run/current-system/sw/bin/rm -f ${bootstrapPrimaryPasswordFile}";
  bootstrapEnsureRepoTarget = pkgs.writeShellScriptBin "nixpi-bootstrap-ensure-repo-target" ''
    set -euo pipefail
    if [ -f "${systemReadyFile}" ]; then
      echo "NixPI bootstrap access is disabled after setup completes" >&2
      exit 1
    fi

    repo_dir="''${1:-}"
    primary_user="''${2:-}"
    if [ -z "$repo_dir" ] || [ -z "$primary_user" ]; then
      echo "usage: nixpi-bootstrap-ensure-repo-target <repo_dir> <primary_user>" >&2
      exit 1
    fi

    install -d -m 0755 /srv
    if [ ! -e "$repo_dir" ]; then
      install -d -o "$primary_user" -g "$primary_user" -m 0755 "$repo_dir"
    else
      chown "$primary_user:$primary_user" "$repo_dir"
      chmod 0755 "$repo_dir"
    fi
  '';
  bootstrapPrepareRepo = pkgs.writeShellScriptBin "nixpi-bootstrap-prepare-repo" ''
    set -euo pipefail
    if [ -f "${systemReadyFile}" ]; then
      echo "NixPI bootstrap access is disabled after setup completes" >&2
      exit 1
    fi

    repo_dir="''${1:-}"
    remote_url="''${2:-}"
    branch="''${3:-}"
    primary_user="''${4:-}"
    if [ -z "$repo_dir" ] || [ -z "$remote_url" ] || [ -z "$branch" ] || [ -z "$primary_user" ]; then
      echo "usage: nixpi-bootstrap-prepare-repo <repo_dir> <remote_url> <branch> <primary_user>" >&2
      exit 1
    fi

    if [ ! -d "$repo_dir/.git" ]; then
      echo "canonical repo checkout is missing .git: $repo_dir" >&2
      exit 1
    fi

    actual_remote="$(${pkgs.git}/bin/git -C "$repo_dir" remote get-url origin 2>/dev/null || true)"
    if [ "$actual_remote" != "$remote_url" ]; then
      echo "canonical repo origin mismatch: expected $remote_url, got ''${actual_remote:-<missing>}" >&2
      exit 1
    fi

    actual_branch="$(${pkgs.git}/bin/git -C "$repo_dir" branch --show-current 2>/dev/null || true)"
    if [ "$actual_branch" != "$branch" ]; then
      echo "canonical repo branch mismatch: expected $branch, got ''${actual_branch:-<detached>}" >&2
      exit 1
    fi

    install -d -m 0755 /etc/nixos
    if [ ! -f /etc/nixos/hardware-configuration.nix ]; then
      cat > /etc/nixos/hardware-configuration.nix <<EOF
{ ... }:
{
}
EOF
    fi

    cat > /etc/nixos/configuration.nix <<EOF
{ ... }:
{
  imports = [
    ./hardware-configuration.nix
    ./nixpi-host.nix
  ];
}
EOF

    cat > /etc/nixos/nixpi-branch-guard.nix <<EOF
{ ... }:
let
  currentBranch = builtins.replaceStrings [ "ref: refs/heads/" "\n" ] [ "" "" ] (builtins.readFile "$repo_dir/.git/HEAD");
in {
  assertions = [
    {
      assertion = currentBranch == "main";
      message = "Supported rebuilds require $repo_dir to be on main";
    }
  ];
}
EOF

    cat > /etc/nixos/flake.nix <<EOF
{
  description = "NixPI installed host";

  inputs.nixpkgs.url = "path:${pkgs.path}";

  outputs = { nixpkgs, ... }:
    let
      system = "${pkgs.stdenv.hostPlatform.system}";
      repoDir = /srv/nixpi;
    in {
      nixosConfigurations.nixpi = nixpkgs.lib.nixosSystem {
        inherit system;
        specialArgs = {
          piAgent = ${piAgent};
          appPackage = ${appPackage};
          setupPackage = ${setupPackage};
        };
        modules = [
          (repoDir + "/core/os/hosts/x86_64.nix")
          ./configuration.nix
          ./nixpi-branch-guard.nix
          {
            nixpkgs.hostPlatform = system;
            nixpkgs.config.allowUnfree = true;
          }
        ];
      };
    };
}
EOF

    rm -f /etc/nixos/flake.lock

    install -d -m 0755 /etc/nixpi
    cat > "${canonicalRepoMetadataPath}" <<EOF
{
  "path": "$repo_dir",
  "origin": "$remote_url",
  "branch": "$branch"
}
EOF
    chown root:root "${canonicalRepoMetadataPath}"
    chmod 0644 "${canonicalRepoMetadataPath}"
  '';
  bootstrapNixosRebuildSwitch = pkgs.writeShellScriptBin "nixpi-bootstrap-nixos-rebuild-switch" ''
    set -euo pipefail
    current_branch="$(${pkgs.git}/bin/git -C ${canonicalRepoDir} branch --show-current 2>/dev/null || true)"
    if [ "$current_branch" != "main" ]; then
      echo "Supported rebuilds require ${canonicalRepoDir} to be on main" >&2
      exit 1
    fi

    if [ -f "${systemReadyFile}" ]; then
      echo "NixPI bootstrap access is disabled after setup completes" >&2
      exit 1
    fi

    exec /run/current-system/sw/bin/nixos-rebuild switch --impure --flake "/etc/nixos#nixpi"
  '';
  bootstrapMatrixJournal = bootstrapAction "matrix-journal" "/run/current-system/sw/bin/journalctl -u continuwuity --no-pager";
  bootstrapNetbird = bootstrapAction "netbird-up" "/run/current-system/sw/bin/netbird up";
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
  bootstrapNetbirdSystemctl = bootstrapAction "netbird-systemctl" "/run/current-system/sw/bin/systemctl";
  bootstrapMatrixSystemctl = bootstrapAction "matrix-systemctl" "/run/current-system/sw/bin/systemctl";
  bootstrapServiceSystemctl = bootstrapAction "service-systemctl" "/run/current-system/sw/bin/systemctl";
  finalizeServiceSystemctl = pkgs.writeShellScriptBin "nixpi-finalize-service-systemctl" ''
    set -euo pipefail
    exec /run/current-system/sw/bin/systemctl "$@"
  '';
  bootstrapSshdSystemctl = bootstrapAction "sshd-systemctl" "/run/current-system/sw/bin/systemctl";
  bootstrapPasswd = bootstrapAction "passwd" "/run/current-system/sw/bin/passwd ${primaryUser}";
  bootstrapChpasswd = bootstrapAction "chpasswd" "/run/current-system/sw/bin/chpasswd";
  bootstrapBroker = bootstrapAction "brokerctl" "/run/current-system/sw/bin/nixpi-brokerctl";
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
      echo "invalid timezone: $tz" >&2; exit 1
    fi
    if ! printf '%s' "$kb" | grep -qE '^[a-zA-Z0-9_-]{1,32}$'; then
      echo "invalid keyboard layout: $kb" >&2; exit 1
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
  imports = [ ./options.nix ];

  environment.systemPackages = [
    bootstrapReadMatrixSecret
    bootstrapReadPrimaryPassword
    bootstrapRemovePrimaryPassword
    bootstrapEnsureRepoTarget
    bootstrapPrepareRepo
    bootstrapNixosRebuildSwitch
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
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-ensure-repo-target *"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-prepare-repo *"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-nixos-rebuild-switch"; options = [ "NOPASSWD" ]; }
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
