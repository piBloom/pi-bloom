{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.services.forgejo;
  forgejo = lib.getExe cfg.package;
in
{
  # Optional bootstrap: place the first admin password at this runtime path
  # through sops-nix or rescue-only provisioning, then restart this unit.
  # Without the file, the unit exits cleanly and the VM still evaluates/builds.
  #
  # Note: Forgejo's admin CLI accepts the initial password as an argument.
  # The unit uses ProtectProc/ProcSubset to reduce local process-list exposure,
  # but the preferred long-term path is wiring this through an encrypted
  # sops-nix secret and running bootstrap only during initial install.
  systemd.services.forgejo-bootstrap = {
    description = "Bootstrap initial Forgejo admin account when secret is present";
    after = [ "forgejo.service" ];
    wants = [ "forgejo.service" ];
    wantedBy = [ "multi-user.target" ];

    serviceConfig = {
      Type = "oneshot";
      User = cfg.user;
      Group = cfg.group;
      WorkingDirectory = cfg.stateDir;
      ProtectProc = "invisible";
      ProcSubset = "pid";
    };

    path = [
      pkgs.coreutils
      pkgs.gawk
      pkgs.gnugrep
      cfg.package
    ];

    environment = {
      USER = cfg.user;
      HOME = cfg.stateDir;
      FORGEJO_WORK_DIR = cfg.stateDir;
      FORGEJO_CUSTOM = "${cfg.stateDir}/custom";
    };

    script = ''
      password_file=/run/secrets/forgejo-admin-password
      if [ ! -s "$password_file" ]; then
        echo "No $password_file present; skipping Forgejo admin bootstrap."
        exit 0
      fi

      if ${forgejo} admin user list | awk '{ print $2 }' | grep -qx nazar; then
        echo "Forgejo admin user nazar already exists."
        exit 0
      fi

      ${forgejo} admin user create \
        --admin \
        --username nazar \
        --email admin@nazar.studio \
        --password "$(tr -d '\n' < "$password_file")"
    '';
  };

  systemd.services.forgejo-vm-git-key-sync = {
    description = "Synchronize Nazar MicroVM Git SSH keys into Forgejo";
    after = [
      "forgejo.service"
      "forgejo-bootstrap.service"
      "nazar-vm-git-ssh-key.service"
    ];
    wants = [ "forgejo.service" ];
    wantedBy = [ "multi-user.target" ];

    path = [
      pkgs.coreutils
      pkgs.curl
      pkgs.findutils
      pkgs.gawk
      pkgs.gnugrep
      pkgs.python3
      cfg.package
    ];

    environment = {
      USER = cfg.user;
      HOME = cfg.stateDir;
      FORGEJO_WORK_DIR = cfg.stateDir;
      FORGEJO_CUSTOM = "${cfg.stateDir}/custom";
    };

    serviceConfig = {
      Type = "oneshot";
      User = "root";
      Group = "root";
      WorkingDirectory = cfg.stateDir;
      ProtectProc = "invisible";
      ProcSubset = "pid";
    };

    script = ''
      set -euo pipefail

      token_file=${cfg.stateDir}/.nazar-vm-git-key-sync-token
      key_root=/var/lib/nazar/fleet-git-keys
      api=http://127.0.0.1:${toString cfg.settings.server.HTTP_PORT}/api/v1
      forgejo_cli() {
        ${pkgs.util-linux}/bin/runuser -u ${cfg.user} -- ${forgejo} "$@"
      }

      if ! forgejo_cli admin user list | awk '{ print $2 }' | grep -qx nazar; then
        echo "Forgejo user nazar does not exist yet; skipping VM Git key sync."
        exit 0
      fi

      if [ ! -s "$token_file" ]; then
        umask 077
        forgejo_cli admin user generate-access-token \
          --username nazar \
          --token-name nazar-vm-git-key-sync \
          --scopes all > "$token_file.raw"
        awk '/Access token was successfully created/{ print $NF } /^[A-Za-z0-9_-]{20,}$/ { token=$0 } END { if (token) print token }' "$token_file.raw" > "$token_file"
        rm -f "$token_file.raw"
      fi

      token=$(tr -d '\n' < "$token_file")
      if [ -z "$token" ]; then
        echo "Forgejo VM key sync token is empty." >&2
        exit 1
      fi

      if [ ! -d "$key_root" ]; then
        echo "No fleet Git key share at $key_root; skipping."
        exit 0
      fi

      find "$key_root" -mindepth 2 -maxdepth 2 -name id_ed25519.pub -type f | sort | while read -r pub; do
        vm_name=$(basename "$(dirname "$pub")")
        title="nazar-microvm-$vm_name"
        key=$(tr -d '\n' < "$pub")
        [ -n "$key" ] || continue

        payload=$(python3 -c 'import json,sys; print(json.dumps({"title": sys.argv[1], "key": sys.argv[2], "read_only": False}))' "$title" "$key")
        status=$(curl -fsS -o /tmp/forgejo-key-sync-response -w '%{http_code}' \
          -H "Authorization: token $token" \
          -H 'Content-Type: application/json' \
          -X POST \
          --data "$payload" \
          "$api/user/keys" || true)

        case "$status" in
          201) echo "Added Forgejo SSH key $title." ;;
          422) echo "Forgejo SSH key $title already exists." ;;
          *)
            echo "Failed to sync Forgejo SSH key $title (HTTP $status):" >&2
            cat /tmp/forgejo-key-sync-response >&2 || true
            exit 1
            ;;
        esac
      done
    '';
  };

  systemd.timers.forgejo-vm-git-key-sync = {
    description = "Retry Nazar MicroVM Git SSH key synchronization";
    wantedBy = [ "timers.target" ];
    timerConfig = {
      OnBootSec = "2min";
      OnUnitActiveSec = "15min";
      Unit = "forgejo-vm-git-key-sync.service";
    };
  };
}
