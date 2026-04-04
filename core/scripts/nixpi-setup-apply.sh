#!/usr/bin/env bash
# nixpi-setup-apply.sh — called by the web wizard backend to write NixOS config
# and promote the installed system. Receives values via environment variables:
#   SETUP_NAME, SETUP_EMAIL, SETUP_USERNAME, SETUP_PASSWORD,
#   SETUP_CLAUDE_API_KEY (optional), SETUP_NETBIRD_KEY (optional)
set -euo pipefail

: "${SETUP_NAME:?SETUP_NAME is required}"
: "${SETUP_EMAIL:?SETUP_EMAIL is required}"
: "${SETUP_USERNAME:?SETUP_USERNAME is required}"
: "${SETUP_PASSWORD:?SETUP_PASSWORD is required}"

PRIMARY_USER="${SETUP_USERNAME}"
PRIMARY_HOME="/home/${PRIMARY_USER}"
NIXPI_DIR="/srv/nixpi"
NIXPI_STATE_DIR="${PRIMARY_HOME}/.nixpi"
BOOTSTRAP_LOG="${NIXPI_STATE_DIR}/bootstrap/full-appliance-upgrade.log"
SYSTEM_READY_FILE="${NIXPI_STATE_DIR}/wizard-state/system-ready"

log() { printf '[setup] %s\n' "$*"; }

log "Starting NixPI setup for user: ${PRIMARY_USER}"

# ---- 1. Write prefill.env for reference and CI re-runs ----
mkdir -p "${NIXPI_STATE_DIR}"
cat > "${NIXPI_STATE_DIR}/prefill.env" <<EOF
PREFILL_NAME="${SETUP_NAME}"
PREFILL_EMAIL="${SETUP_EMAIL}"
PREFILL_USERNAME="${SETUP_USERNAME}"
PREFILL_PRIMARY_PASSWORD="${SETUP_PASSWORD}"
PREFILL_NETBIRD_KEY="${SETUP_NETBIRD_KEY:-}"
EOF
chown "${PRIMARY_USER}:${PRIMARY_USER}" "${NIXPI_STATE_DIR}/prefill.env"
chmod 0600 "${NIXPI_STATE_DIR}/prefill.env"
log "Wrote prefill.env"

# ---- 2. Set user password ----
log "Setting password for ${PRIMARY_USER}..."
echo "${PRIMARY_USER}:${SETUP_PASSWORD}" | chpasswd
log "Password set"

# ---- 3. Clone nixpi repo if not present ----
if [[ ! -d "${NIXPI_DIR}/.git" ]]; then
  BOOTSTRAP_REPO="${NIXPI_BOOTSTRAP_REPO:-https://github.com/alexradunet/nixpi.git}"
  BOOTSTRAP_BRANCH="${NIXPI_BOOTSTRAP_BRANCH:-main}"
  log "Cloning ${BOOTSTRAP_REPO} (${BOOTSTRAP_BRANCH}) to ${NIXPI_DIR}..."
  mkdir -p "$(dirname "${NIXPI_DIR}")"
  git clone --branch "${BOOTSTRAP_BRANCH}" "${BOOTSTRAP_REPO}" "${NIXPI_DIR}"
  chown -R "${PRIMARY_USER}:${PRIMARY_USER}" "${NIXPI_DIR}"
  log "Repository cloned"
else
  log "Repository already present at ${NIXPI_DIR}"
fi

# ---- 4. Write nixpi-host.nix ----
HOST_FILE="${NIXPI_DIR}/nixpi-host.nix"
HOSTNAME="$(hostname)"
log "Writing host config to ${HOST_FILE}..."
cat > "${HOST_FILE}" <<NIX
{ config, ... }:
{
  nixpi.primaryUser = "${PRIMARY_USER}";
  networking.hostName = "${HOSTNAME}";
  time.timeZone = "UTC";
  nixpi.timezone = "UTC";
}
NIX
chown "${PRIMARY_USER}:${PRIMARY_USER}" "${HOST_FILE}"
log "Host config written"

# ---- 5. Store Claude API key in Pi config if provided ----
if [[ -n "${SETUP_CLAUDE_API_KEY:-}" ]]; then
  PI_DIR="${PRIMARY_HOME}/.pi"
  mkdir -p "${PI_DIR}"
  if [[ -f "${PI_DIR}/settings.json" ]]; then
    tmp="$(mktemp)"
    jq --arg key "${SETUP_CLAUDE_API_KEY}" \
      '.providerKeys = (.providerKeys // {}) | .providerKeys.anthropic = $key' \
      "${PI_DIR}/settings.json" > "$tmp"
    mv "$tmp" "${PI_DIR}/settings.json"
  fi
  chown -R "${PRIMARY_USER}:${PRIMARY_USER}" "${PI_DIR}"
  log "Claude API key stored"
fi

# ---- 6. Configure Netbird key if provided ----
if [[ -n "${SETUP_NETBIRD_KEY:-}" ]]; then
  log "Configuring Netbird..."
  netbird up --setup-key "${SETUP_NETBIRD_KEY}" --foreground=false || true
  log "Netbird configured"
fi

# ---- 7. Run nixos-rebuild switch ----
log "Running nixos-rebuild switch (this takes a few minutes)..."
mkdir -p "$(dirname "${BOOTSTRAP_LOG}")"
nixos-rebuild switch --flake "${NIXPI_DIR}" 2>&1 | tee -a "${BOOTSTRAP_LOG}"
log "nixos-rebuild switch complete"

# ---- 8. Write system-ready marker ----
mkdir -p "$(dirname "${SYSTEM_READY_FILE}")"
touch "${SYSTEM_READY_FILE}"
chown "${PRIMARY_USER}:${PRIMARY_USER}" "${SYSTEM_READY_FILE}"
log "System ready"
