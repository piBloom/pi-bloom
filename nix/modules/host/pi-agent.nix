{ lib, pkgs, ... }:
let
  pi = pkgs.callPackage ../../packages/pi { };
  sharedAuthDir = "/persist/microvms/shared/pi-agent";
in
{
  imports = [ ../guest/pi-default-packages.nix ];

  environment.systemPackages = [
    pi
    pkgs.nodejs

    # LSP servers for pi-lens (avoids broken auto-installer)
    pkgs.nixd                       # Nix
    pkgs.typescript-language-server  # TypeScript/JavaScript
    pkgs.pyright                    # Python
  ];

  environment.sessionVariables = {
    PI_TELEMETRY = "0";
    PI_SKIP_VERSION_CHECK = "1";
  };

  # Nazar is the canonical place to log into Pi. Keep auth/model files in a
  # host-private directory that VM Pi agents mount, while leaving sessions,
  # extension installs, caches, and project settings local to each machine.
  system.activationScripts.nazar-pi-shared-auth = lib.stringAfter [ "users" "nazar-pi-default-packages" ] ''
    set -euo pipefail

    agent_dir=/home/alex/.pi/agent
    shared_dir=${lib.escapeShellArg sharedAuthDir}

    install -d -m 0755 -o alex -g users "$agent_dir"
    install -d -m 0700 -o alex -g users "$shared_dir"

    link_shared_file() {
      local name="$1"
      local mode="$2"
      local local_file="$agent_dir/$name"
      local shared_file="$shared_dir/$name"
      local backup_file="$agent_dir/$name.host-local-backup"

      if [ -e "$local_file" ] && [ ! -L "$local_file" ]; then
        if [ ! -e "$shared_file" ]; then
          install -m "$mode" -o alex -g users "$local_file" "$shared_file"
        elif [ ! -e "$backup_file" ]; then
          install -m "$mode" -o alex -g users "$local_file" "$backup_file"
        fi
        rm -f "$local_file"
      fi

      ln -sfn "$shared_file" "$local_file"

      if [ -e "$shared_file" ]; then
        chown alex:users "$shared_file"
        chmod "$mode" "$shared_file"
      fi
    }

    link_shared_file auth.json 0600
    link_shared_file models.json 0600
  '';
}
