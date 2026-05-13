{ pkgs, ... }:
let
  inventory = pkgs.writeShellScriptBin "nazar-backup-inventory" ''
    set -eu
    cat <<'EOF'
    Nazar backup roots after NixOS+MicroVM migration:
      /srv/nazar
      /persist/repos
      /persist/microvms/git
      /persist/microvms/minecraft
      /persist/microvms/dav-server
      /persist/secrets

    This host module intentionally does not encode an off-host backup target or
    credentials. Configure restic/borg/rclone later with secrets outside git.
    EOF
  '';
in
{
  environment.systemPackages = [ inventory ];

  systemd.tmpfiles.rules = [
    "d /persist/backups 0700 root root - -"
    "d /persist/backups/git-bundles 0700 root root - -"
  ];
}
