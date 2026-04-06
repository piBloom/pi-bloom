#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${1:?repo dir required}"
HOSTNAME_VALUE="${2:?hostname required}"
PRIMARY_USER_VALUE="${3:?primary user required}"
TIMEZONE_VALUE="${4:?timezone required}"
KEYBOARD_VALUE="${5:?keyboard required}"
SYSTEM_VALUE="${6:-}"
NIXOS_DIR="/etc/nixos"
HOST_FILE="$NIXOS_DIR/nixpi-host.nix"
INTEGRATION_FILE="$NIXOS_DIR/nixpi-integration.nix"
FLAKE_FILE="$NIXOS_DIR/flake.nix"
NIXPKGS_FLAKE_URL="${NIXPI_NIXPKGS_FLAKE_URL:-}"

install -d -m 0755 "$NIXOS_DIR"

resolve_nixpkgs_flake_url() {
  if [ -n "$NIXPKGS_FLAKE_URL" ]; then
    printf '%s\n' "$NIXPKGS_FLAKE_URL"
    return 0
  fi

  for candidate in \
    /nix/var/nix/profiles/per-user/root/channels/nixos \
    /nix/var/nix/profiles/system/channels/nixos \
    /root/.nix-defexpr/channels/nixos
  do
    if [ -f "$candidate/flake.nix" ]; then
      printf 'path:%s\n' "$candidate"
      return 0
    fi
  done

  echo "could not determine the host nixpkgs flake source" >&2
  echo "set NIXPI_NIXPKGS_FLAKE_URL to the nixpkgs flake you want /etc/nixos to follow" >&2
  return 1
}

NIXPKGS_FLAKE_URL="$(resolve_nixpkgs_flake_url)"

if [ -z "$SYSTEM_VALUE" ]; then
  case "$(uname -m)" in
    x86_64)
      SYSTEM_VALUE="x86_64-linux"
      ;;
    aarch64|arm64)
      SYSTEM_VALUE="aarch64-linux"
      ;;
    *)
      echo "unsupported machine architecture: $(uname -m)" >&2
      exit 1
      ;;
  esac
fi

cat > "$HOST_FILE" <<EOF_HOST
{ ... }:
{
  networking.hostName = "${HOSTNAME_VALUE}";
  nixpi.primaryUser = "${PRIMARY_USER_VALUE}";
  nixpi.timezone = "${TIMEZONE_VALUE}";
  nixpi.keyboard = "${KEYBOARD_VALUE}";
}
EOF_HOST

cat > "$INTEGRATION_FILE" <<'EOF_INTEGRATION'
{ nixpi, ... }:
{
  imports = [
    nixpi.nixosModules.nixpi
    ./nixpi-host.nix
  ];
}
EOF_INTEGRATION

if [ ! -f "$FLAKE_FILE" ]; then
  cat > "$FLAKE_FILE" <<EOF_FLAKE
{
  description = "Host-owned NixOS flake with NixPI layered on top";

  inputs = {
    nixpkgs.url = "${NIXPKGS_FLAKE_URL}";
    nixpi.url = "path:${REPO_DIR}";
  };

  outputs = { nixpkgs, nixpi, ... }:
    let
      system = "${SYSTEM_VALUE}";
      lib = nixpkgs.lib;
      existingModules =
        lib.optionals (builtins.pathExists ./configuration.nix) [ ./configuration.nix ]
        ++ lib.optionals (builtins.pathExists ./hardware-configuration.nix) [ ./hardware-configuration.nix ];
    in {
      nixosConfigurations.${HOSTNAME_VALUE} = nixpkgs.lib.nixosSystem {
        inherit system;
        specialArgs = {
          self = nixpi;
          piAgent = nixpi.packages.\${system}.pi;
          appPackage = nixpi.packages.\${system}.app;
          setupApplyPackage = nixpi.packages.\${system}.nixpi-setup-apply;
        };
        modules = existingModules ++ [
          (import ./nixpi-integration.nix { inherit nixpi; })
        ];
      };
    };
}
EOF_FLAKE
fi
