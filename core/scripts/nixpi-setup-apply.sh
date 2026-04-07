#!/usr/bin/env bash
set -euo pipefail

resolve_primary_user() {
  if [[ -n "${NIXPI_PRIMARY_USER:-}" ]]; then
    printf '%s\n' "$NIXPI_PRIMARY_USER"
    return 0
  fi

  if [[ -n "${SUDO_USER:-}" ]]; then
    printf '%s\n' "$SUDO_USER"
    return 0
  fi

  if [[ "$(id -u)" -ne 0 ]]; then
    id -un
    return 0
  fi

  local discovered_user
  discovered_user="$(
    getent passwd | awk -F: '$3 >= 1000 && $3 < 60000 && $1 != "nobody" { print $1; exit }'
  )"

  if [[ -n "$discovered_user" ]]; then
    printf '%s\n' "$discovered_user"
    return 0
  fi

  echo "[setup] Could not infer the existing non-root user. Set NIXPI_PRIMARY_USER explicitly." >&2
  return 1
}

PRIMARY_USER="$(resolve_primary_user)"
PRIMARY_HOME="/home/${PRIMARY_USER}"
NIXPI_STATE_DIR="${PRIMARY_HOME}/.nixpi"
SYSTEM_READY_FILE="${NIXPI_STATE_DIR}/wizard-state/system-ready"

log() { printf '[setup] %s\n' "$*"; }

mkdir -p "$(dirname "${SYSTEM_READY_FILE}")"
touch "${SYSTEM_READY_FILE}"
chown "${PRIMARY_USER}:${PRIMARY_USER}" "${SYSTEM_READY_FILE}"
log "System ready"
