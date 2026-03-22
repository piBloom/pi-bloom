{ config, pkgs, lib, ... }:

let
  resolved = import ../lib/resolve-primary-user.nix { inherit lib config; };
  primaryUser = resolved.resolvedPrimaryUser;
  primaryHome = resolved.resolvedPrimaryHome;
  stateDir = config.nixpi.stateDir;
  setupCompleteFile = "${primaryHome}/.nixpi/.setup-complete";
  matrixRegistrationSecretFile =
    if config.nixpi.matrix.registrationSharedSecretFile != null then
      config.nixpi.matrix.registrationSharedSecretFile
    else
      "${stateDir}/secrets/matrix-registration-shared-secret";
  bootstrapPrimaryPasswordFile = "${stateDir}/bootstrap/primary-user-password";
  bootstrapAction = action: command: pkgs.writeShellScriptBin "nixpi-bootstrap-${action}" ''
    set -euo pipefail
    if [ -f "${setupCompleteFile}" ]; then
      echo "NixPI bootstrap access is disabled after setup completes" >&2
      exit 1
    fi
    exec ${command} "$@"
  '';
  bootstrapReadMatrixSecret = bootstrapAction "read-matrix-secret" "/run/current-system/sw/bin/sh -c 'tr -d \"\\n\" < ${matrixRegistrationSecretFile}'";
  bootstrapReadPrimaryPassword = bootstrapAction "read-primary-password" "/run/current-system/sw/bin/sh -c 'tr -d \"\\n\" < ${bootstrapPrimaryPasswordFile}'";
  bootstrapRemovePrimaryPassword = bootstrapAction "remove-primary-password" "/run/current-system/sw/bin/rm -f ${bootstrapPrimaryPasswordFile}";
  bootstrapMatrixJournal = bootstrapAction "matrix-journal" "/run/current-system/sw/bin/journalctl -u continuwuity --no-pager";
  bootstrapNetbird = bootstrapAction "netbird-up" "/run/current-system/sw/bin/netbird up";
  bootstrapNetbirdSystemctl = bootstrapAction "netbird-systemctl" "/run/current-system/sw/bin/systemctl";
  bootstrapMatrixSystemctl = bootstrapAction "matrix-systemctl" "/run/current-system/sw/bin/systemctl";
  bootstrapServiceSystemctl = bootstrapAction "service-systemctl" "/run/current-system/sw/bin/systemctl";
  bootstrapSshdSystemctl = bootstrapAction "sshd-systemctl" "/run/current-system/sw/bin/systemctl";
  bootstrapPasswd = bootstrapAction "passwd" "/run/current-system/sw/bin/passwd ${primaryUser}";
  bootstrapChpasswd = bootstrapAction "chpasswd" "/run/current-system/sw/bin/chpasswd";
  bootstrapBroker = bootstrapAction "brokerctl" "/run/current-system/sw/bin/nixpi-brokerctl";
  bootstrapMatrixExecute = pkgs.writeShellScriptBin "nixpi-bootstrap-matrix-execute" ''
    set -euo pipefail
    if [ -f "${setupCompleteFile}" ]; then
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
    bootstrapMatrixJournal
    bootstrapNetbird
    bootstrapNetbirdSystemctl
    bootstrapMatrixSystemctl
    bootstrapServiceSystemctl
    bootstrapSshdSystemctl
    bootstrapPasswd
    bootstrapChpasswd
    bootstrapBroker
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
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-netbird-systemctl * netbird.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-matrix-systemctl try-restart continuwuity.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-service-systemctl restart nixpi-home.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-service-systemctl restart nixpi-element-web.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-service-systemctl enable --now nixpi-daemon.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-sshd-systemctl stop sshd.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-passwd"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-chpasswd"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-brokerctl systemd *"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-brokerctl status"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-matrix-execute *"; options = [ "NOPASSWD" ]; }
    ];
  };
}
