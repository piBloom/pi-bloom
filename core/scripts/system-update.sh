#!/usr/bin/env bash
# system-update.sh — NixOS OTA update + status-file writer.
# Runs as root via nixpi-update.service. Writes status to the primary NixPI
# operator's ~/.nixpi/update-status.json path.
set -euo pipefail

LOCAL_HOST="$(hostname -s)"
NIXPI_PRIMARY_USER="${NIXPI_PRIMARY_USER:-pi}"
NIXPI_PRIMARY_HOME="/home/${NIXPI_PRIMARY_USER}"
LOCAL_FLAKE_DIR="${NIXPI_SYSTEM_FLAKE_DIR:-/etc/nixos}"
STATUS_DIR="${NIXPI_PRIMARY_HOME}/.nixpi"
STATUS_FILE="$STATUS_DIR/update-status.json"
CHECKED=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

if [[ ! -f "${LOCAL_FLAKE_DIR}/flake.nix" ]]; then
  echo "Missing ${LOCAL_FLAKE_DIR}/flake.nix; NixPI updates require a host-owned flake in /etc/nixos that imports /srv/nixpi." >&2
  exit 1
fi

FLAKE_REF="$LOCAL_FLAKE_DIR"
HOST="$LOCAL_HOST"
FLAKE="$LOCAL_FLAKE_DIR"

mkdir -p "$STATUS_DIR"
chown "${NIXPI_PRIMARY_USER}" "$STATUS_DIR" 2>/dev/null || true

# Current generation number
CURRENT_GEN=$(nix-env --list-generations -p /nix/var/nix/profiles/system 2>/dev/null | grep current | awk '{print $1}' || echo "0")

# Check if remote flake produces a different system closure
CURRENT_SYSTEM=$(readlink /run/current-system)
# nix build uses full nixosConfigurations attribute path (not the short #host fragment)
NEW_SYSTEM=$(nix build "${FLAKE_REF}#nixosConfigurations.${HOST}.config.system.build.toplevel" --no-link --print-out-paths 2>/dev/null || echo "")

if [[ -z "$NEW_SYSTEM" ]] || [[ "$NEW_SYSTEM" == "$CURRENT_SYSTEM" ]]; then
  AVAILABLE=false
else
  AVAILABLE=true
fi

# Preserve notified flag
NOTIFIED=false
if [[ -f "$STATUS_FILE" ]] && [[ "$AVAILABLE" = "true" ]]; then
  NOTIFIED=$(jq -r '.notified // false' "$STATUS_FILE" 2>/dev/null || echo "false")
fi

# Write pre-apply status
jq -n \
  --arg checked "$CHECKED" \
  --argjson available "$AVAILABLE" \
  --arg generation "$CURRENT_GEN" \
  --argjson notified "$NOTIFIED" \
  '{"checked": $checked, "available": $available, "generation": $generation, "notified": $notified}' \
  > "$STATUS_FILE"
chown "${NIXPI_PRIMARY_USER}" "$STATUS_FILE"

# Apply if available
if [[ "$AVAILABLE" = "true" ]]; then
  if nixos-rebuild switch --flake "$FLAKE" --impure; then
    NEW_GEN=$(nix-env --list-generations -p /nix/var/nix/profiles/system 2>/dev/null | grep current | awk '{print $1}' || echo "0")
    jq -n \
      --arg checked "$CHECKED" \
      --arg generation "$NEW_GEN" \
      '{"checked": $checked, "available": false, "generation": $generation, "notified": false}' \
      > "$STATUS_FILE"
    chown "${NIXPI_PRIMARY_USER}" "$STATUS_FILE"
  fi
fi
