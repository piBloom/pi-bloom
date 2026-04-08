#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF_USAGE'
Usage: nixpi-deploy-ovh --target-host root@IP --disk /dev/sdX [--flake .#ovh-vps] [--hostname HOSTNAME] [--bootstrap-user USER --bootstrap-password-hash HASH] [extra nixos-anywhere args...]

Destructive fresh install for an OVH VPS in rescue mode.

Examples:
  nix run .#nixpi-deploy-ovh -- --target-host root@198.51.100.10 --disk /dev/sda
  nix run .#nixpi-deploy-ovh -- --target-host root@198.51.100.10 --disk /dev/nvme0n1 --hostname bloom-eu-1
  nix run .#nixpi-deploy-ovh -- --target-host root@198.51.100.10 --disk /dev/sda --bootstrap-user human --bootstrap-password-hash '$6$...'
EOF_USAGE
}

log() {
  printf '[nixpi-deploy-ovh] %s\n' "$*" >&2
}

resolve_repo_url() {
  local ref="$1"
  if [[ "$ref" == path:* || "$ref" == github:* || "$ref" == git+* || "$ref" == https://* || "$ref" == ssh://* ]]; then
    printf '%s\n' "$ref"
    return 0
  fi

  if [[ "$ref" == . || "$ref" == /* ]]; then
    printf 'path:%s\n' "$(realpath "$ref")"
    return 0
  fi

  printf '%s\n' "$ref"
}

escape_nix_string() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//\$/\\\$}"
  value="${value//$'\n'/\\n}"
  printf '%s' "$value"
}

TARGET_HOST=""
DISK=""
HOSTNAME="ovh-vps"
FLAKE_REF="${NIXPI_REPO_ROOT:-.}#ovh-vps"
BOOTSTRAP_USER=""
BOOTSTRAP_PASSWORD_HASH=""
EXTRA_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target-host)
      TARGET_HOST="${2:?missing target host}"
      shift 2
      ;;
    --disk)
      DISK="${2:?missing disk path}"
      shift 2
      ;;
    --flake)
      FLAKE_REF="${2:?missing flake ref}"
      shift 2
      ;;
    --hostname)
      HOSTNAME="${2:?missing hostname}"
      shift 2
      ;;
    --bootstrap-user)
      BOOTSTRAP_USER="${2:?missing bootstrap user}"
      shift 2
      ;;
    --bootstrap-password-hash)
      BOOTSTRAP_PASSWORD_HASH="${2:?missing bootstrap password hash}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      EXTRA_ARGS+=("$1")
      shift
      ;;
  esac
done

if [[ -z "$TARGET_HOST" || -z "$DISK" ]]; then
  usage >&2
  exit 1
fi

if [[ "$FLAKE_REF" != *#* ]]; then
  log "Flake ref must include a nixosConfigurations attribute, for example .#ovh-vps"
  exit 1
fi

if [[ -n "$BOOTSTRAP_USER" && -z "$BOOTSTRAP_PASSWORD_HASH" ]]; then
  log "--bootstrap-user requires --bootstrap-password-hash"
  exit 1
fi

if [[ -z "$BOOTSTRAP_USER" && -n "$BOOTSTRAP_PASSWORD_HASH" ]]; then
  log "--bootstrap-password-hash requires --bootstrap-user"
  exit 1
fi

REPO_REF="${FLAKE_REF%%#*}"
BASE_ATTR="${FLAKE_REF#*#}"
REPO_URL="$(resolve_repo_url "$REPO_REF")"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
NIX_HOSTNAME="$(escape_nix_string "$HOSTNAME")"
NIX_DISK="$(escape_nix_string "$DISK")"
BOOTSTRAP_MODULE=""

if [[ -n "$BOOTSTRAP_USER" ]]; then
  NIX_BOOTSTRAP_USER="$(escape_nix_string "$BOOTSTRAP_USER")"
  NIX_BOOTSTRAP_PASSWORD_HASH="$(escape_nix_string "$BOOTSTRAP_PASSWORD_HASH")"
  BOOTSTRAP_MODULE=$(cat <<EOF_BOOTSTRAP
        ({ lib, ... }: {
          nixpi.primaryUser = lib.mkForce "${NIX_BOOTSTRAP_USER}";
          nixpi.security.ssh.passwordAuthentication = lib.mkForce true;
          nixpi.security.ssh.allowUsers = lib.mkForce [ "${NIX_BOOTSTRAP_USER}" ];
          users.users."${NIX_BOOTSTRAP_USER}".initialHashedPassword = lib.mkForce "${NIX_BOOTSTRAP_PASSWORD_HASH}";
        })
EOF_BOOTSTRAP
)
fi

cat > "$TMP_DIR/flake.nix" <<EOF_FLAKE
{
  inputs.nixpi.url = "${REPO_URL}";

  outputs = { nixpi, ... }: {
    nixosConfigurations.deploy = nixpi.nixosConfigurations.${BASE_ATTR}.extendModules {
      modules = [
        ({ lib, ... }: {
          networking.hostName = lib.mkForce "${NIX_HOSTNAME}";
          disko.devices.disk.main.device = lib.mkForce "${NIX_DISK}";
        })
${BOOTSTRAP_MODULE}
      ];
    };
  };
}
EOF_FLAKE

log "WARNING: destructive install to ${TARGET_HOST} using disk ${DISK}"
log "Using base configuration ${FLAKE_REF} with target hostname ${HOSTNAME}"
log "nixos-anywhere will install the final host configuration directly"
log "Any /srv/nixpi checkout after install is optional operator convenience"
if [[ -n "$BOOTSTRAP_USER" ]]; then
  log "Bootstrap login will be ${BOOTSTRAP_USER} using initialHashedPassword"
fi
exec "${NIXPI_NIXOS_ANYWHERE:-nixos-anywhere}" \
  --flake "$TMP_DIR#deploy" \
  --target-host "$TARGET_HOST" \
  "${EXTRA_ARGS[@]}"
