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
}
