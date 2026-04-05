#!/usr/bin/env bash
set -euo pipefail

PRIMARY_USER="${NIXPI_PRIMARY_USER:-${SUDO_USER:-human}}"
PRIMARY_HOME="/home/${PRIMARY_USER}"
NIXPI_STATE_DIR="${PRIMARY_HOME}/.nixpi"
SYSTEM_READY_FILE="${NIXPI_STATE_DIR}/wizard-state/system-ready"

log() { printf '[setup] %s\n' "$*"; }

if [[ -n "${SETUP_NETBIRD_KEY:-}" ]]; then
  log "Configuring Netbird..."
  if ! netbird up --setup-key "${SETUP_NETBIRD_KEY}" --foreground=false; then
    log "Netbird setup failed; continuing without mesh connectivity"
  fi
fi

mkdir -p "$(dirname "${SYSTEM_READY_FILE}")"
touch "${SYSTEM_READY_FILE}"
chown "${PRIMARY_USER}:${PRIMARY_USER}" "${SYSTEM_READY_FILE}"
log "System ready"
