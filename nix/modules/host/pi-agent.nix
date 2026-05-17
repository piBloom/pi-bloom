{ lib, pkgs, ... }:
let
  pi = pkgs.callPackage ../../packages/pi { };
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

  # Pi auth/model files are host-local. NixPi is responsible for copying the
  # current host files into SSH workspaces at runtime before it starts remote
  # `pi --mode rpc`; do not maintain a shared host/VM auth mount here.
  system.activationScripts.nazar-pi-local-auth = lib.stringAfter [ "users" "nazar-pi-default-packages" ] ''
    set -euo pipefail

    agent_dir=/home/alex/.pi/agent
    install -d -m 0755 -o alex -g users "$agent_dir"

    localize_file() {
      local name="$1"
      local mode="$2"
      local file="$agent_dir/$name"

      if [ -L "$file" ]; then
        target="$(${pkgs.coreutils}/bin/readlink -f "$file" || true)"
        if [ -n "$target" ] && [ -e "$target" ]; then
          tmp="$file.localizing"
          install -m "$mode" -o alex -g users "$target" "$tmp"
          mv -f "$tmp" "$file"
        else
          rm -f "$file"
        fi
      fi

      if [ -e "$file" ]; then
        chown alex:users "$file"
        chmod "$mode" "$file"
      fi
    }

    localize_file auth.json 0600
    localize_file models.json 0600
  '';
}
