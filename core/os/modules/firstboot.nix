{ config, pkgs, lib, ... }:

let
  primaryUser = config.nixpi.primaryUser;
  primaryHome = "/home/${primaryUser}";
  stateDir = config.nixpi.stateDir;
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
  bootstrapInstallHostFlake = pkgs.writeShellScriptBin "nixpi-bootstrap-install-host-flake" ''
    set -euo pipefail
    if [ -f "${systemReadyFile}" ]; then
      echo "NixPI bootstrap access is disabled after setup completes" >&2
      exit 1
    fi

    nixpi_dir="''${1:-}"
    hostname="''${2:-}"
    primary_user="''${3:-}"
    if [ -z "$nixpi_dir" ] || [ -z "$hostname" ] || [ -z "$primary_user" ]; then
      echo "usage: nixpi-bootstrap-install-host-flake <nixpi_dir> <hostname> <primary_user>" >&2
      exit 1
    fi

    install -d -m 0755 /etc/nixos

    cat > /etc/nixos/nixpi-host.nix <<EOF
{ ... }:
{
  networking.hostName = "$hostname";
  nixpi.primaryUser = "$primary_user";
}
EOF

    cat > /etc/nixos/configuration.nix <<EOF
{ ... }:
{
  imports = [
    $nixpi_dir/core/os/hosts/x86_64.nix
    ./hardware-configuration.nix
    ./nixpi-host.nix
  ];
}
EOF

    cat > /etc/nixos/flake.nix <<EOF
{
  description = "NixPI installed host";

  inputs = {
    nixpi.url = "path:$nixpi_dir";
    nixpkgs.follows = "nixpi/nixpkgs";
  };

  outputs = { nixpi, nixpkgs, ... }:
    let
      system = "${pkgs.stdenv.hostPlatform.system}";
    in {
      nixosConfigurations."$hostname" = nixpkgs.lib.nixosSystem {
        inherit system;
        specialArgs = {
          piAgent = nixpi.packages.\''${system}.pi;
          appPackage = nixpi.packages.\''${system}.app;
          setupPackage = nixpi.packages.\''${system}.nixpi-setup;
        };
        modules = [
          ./configuration.nix
          {
            nixpkgs.hostPlatform = system;
            nixpkgs.config.allowUnfree = true;
          }
        ];
      };
    };
}
EOF
  '';
  bootstrapNixosRebuildSwitch = pkgs.writeShellScriptBin "nixpi-bootstrap-nixos-rebuild-switch" ''
    set -euo pipefail
    if [ -f "${systemReadyFile}" ]; then
      echo "NixPI bootstrap access is disabled after setup completes" >&2
      exit 1
    fi

    hostname="''${1:-}"
    if [ -z "$hostname" ]; then
      echo "usage: nixpi-bootstrap-nixos-rebuild-switch <hostname>" >&2
      exit 1
    fi

    exec /run/current-system/sw/bin/nixos-rebuild switch --impure --flake "/etc/nixos#$hostname"
  '';
  bootstrapMatrixJournal = bootstrapAction "matrix-journal" "/run/current-system/sw/bin/journalctl -u continuwuity --no-pager";
  bootstrapNetbird = bootstrapAction "netbird-up" "/run/current-system/sw/bin/netbird up";
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
    bootstrapInstallHostFlake
    bootstrapNixosRebuildSwitch
    bootstrapMatrixJournal
    bootstrapNetbird
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
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-install-host-flake *"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-nixos-rebuild-switch *"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-matrix-journal"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-matrix-systemctl stop continuwuity.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-matrix-systemctl start continuwuity.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-matrix-systemctl restart continuwuity.service"; options = [ "NOPASSWD" ]; }
      { command = "/run/current-system/sw/bin/nixpi-bootstrap-netbird-up --setup-key *"; options = [ "NOPASSWD" ]; }
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
