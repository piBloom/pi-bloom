#!/usr/bin/env bash
# firstboot.sh — Non-interactive first-boot preparation for nixPI.
# Runs before getty via nixpi-firstboot.service as the primary nixPI user.
# If ~/.nixpi/prefill.env is present, first boot completes unattended; otherwise
# it performs background preparation and leaves the interactive wizard pending.
# On failure, exits 1 (non-fatal per SuccessExitStatus). User can re-run
# setup-wizard.sh on next login to resume from the last incomplete checkpoint.
set -euo pipefail

# Logging setup - log to file for debugging
FIRSTBOOT_LOG="$HOME/.nixpi/firstboot.log"
mkdir -p "$(dirname "$FIRSTBOOT_LOG")"
exec > >(tee -a "$FIRSTBOOT_LOG") 2>&1

echo "=== nixPI Firstboot Started: $(date) ==="

WIZARD_STATE="$HOME/.nixpi/wizard-state"
SETUP_COMPLETE="$HOME/.nixpi/.setup-complete"
NIXPI_DIR="${NIXPI_DIR:-$HOME/nixPI}"
SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
NIXPI_CONFIG="$HOME/.config/nixpi"
PI_DIR="$HOME/.pi"
MATRIX_HOMESERVER="http://localhost:6167"
MATRIX_STATE_DIR="$WIZARD_STATE/matrix-state"

PREFILL_FILE="$HOME/.nixpi/prefill.env"
if [[ -f "$PREFILL_FILE" ]]; then
    # shellcheck source=/dev/null
    source "$PREFILL_FILE"
fi

NONINTERACTIVE_INSTALL=0
if [[ -f "$PREFILL_FILE" ]]; then
    NONINTERACTIVE_INSTALL=1
fi

SUDO_BIN=""
if command -v sudo >/dev/null 2>&1; then
    SUDO_BIN="$(command -v sudo)"
elif [[ -x /run/wrappers/bin/sudo ]]; then
    SUDO_BIN="/run/wrappers/bin/sudo"
fi

# Load shared function library.
# firstboot.sh is run directly from the Nix source tree (not via app),
# so $(dirname "$0") points into the source store, not app's $out/bin/.
# The dirname probe is kept for pattern consistency but will always fall through
# to the /run/current-system/sw/bin fallback at runtime.
SETUP_LIB="$(dirname "$0")/setup-lib.sh"
if [[ ! -f "$SETUP_LIB" ]]; then
    SETUP_LIB="/run/current-system/sw/bin/setup-lib.sh"
fi
# shellcheck source=setup-lib.sh
source "$SETUP_LIB"

step_done() { [[ -f "$WIZARD_STATE/$1" ]]; }

run_root_command() {
    if [[ -n "$SUDO_BIN" ]]; then
        "$SUDO_BIN" "$@"
    else
        "$@"
    fi
}

# --- First-boot steps ---

firstboot_netbird() {
    [[ -z "${PREFILL_NETBIRD_KEY:-}" ]] && { echo "nixpi-firstboot: no NetBird key, skipping"; return 0; }
    echo "nixpi-firstboot: connecting to NetBird..."
    if ! systemctl is-active --quiet netbird.service; then
        run_root_command systemctl start netbird.service
    fi
    local wait_count=0
    while [[ ! -S /var/run/netbird/sock ]]; do
        wait_count=$((wait_count + 1))
        [[ $wait_count -ge 20 ]] && { echo "nixpi-firstboot: NetBird daemon did not start" >&2; return 1; }
        sleep 0.5
    done
    if run_root_command netbird up --setup-key "$PREFILL_NETBIRD_KEY"; then
        sleep 3
        local mesh_ip
        mesh_ip=$(netbird status 2>/dev/null | grep -oP 'NetBird IP:\s+\K[\d.]+' || true)
        [[ -n "$mesh_ip" ]] && mark_done_with netbird "$mesh_ip"
        echo "nixpi-firstboot: NetBird connected (${mesh_ip:-unknown IP})"
    else
        echo "nixpi-firstboot: NetBird connection failed" >&2
        return 1
    fi
}

firstboot_matrix() {
    [[ -z "${PREFILL_USERNAME:-}" ]] && { echo "nixpi-firstboot: no Matrix username, skipping"; return 0; }
    echo "nixpi-firstboot: setting up Matrix..."
    # Poll until homeserver accepts connections (up to 60s)
    local attempts=0
    until curl -sf "http://localhost:6167/_matrix/client/versions" >/dev/null 2>&1; do
        attempts=$((attempts + 1))
        [[ $attempts -ge 60 ]] && { echo "nixpi-firstboot: Matrix homeserver not ready after 60s" >&2; return 1; }
        sleep 1
    done
    echo "nixpi-firstboot: Matrix homeserver ready"
    # Delegate to wizard's step_matrix (reads PREFILL_USERNAME from env)
    step_matrix
}

firstboot_services() {
    echo "nixpi-firstboot: provisioning Home..."
    local mesh_ip mesh_fqdn
    mesh_ip=$(read_checkpoint_data netbird)
    mesh_fqdn=$(netbird_fqdn)
    write_fluffychat_runtime_config
    write_service_home_runtime "$mesh_ip" "$mesh_fqdn"
    install_home_infrastructure || echo "nixpi-firstboot: Home setup failed (non-fatal)"
    systemctl --user restart nixpi-chat.service || echo "nixpi-firstboot: chat restart failed (non-fatal)" >&2
    systemctl --user restart nixpi-files.service || echo "nixpi-firstboot: files restart failed (non-fatal)" >&2
    systemctl --user restart nixpi-code.service || echo "nixpi-firstboot: code-server restart failed (non-fatal)" >&2
    mark_done_with services "chat files code"
}

firstboot_localai() {
    # localai-download.service starts automatically (localai.service requires it).
    # This step surfaces the status so it appears in the firstboot log.
    local state
    state=$(systemctl is-active localai-download.service 2>/dev/null || true)
    case "$state" in
        active)
            echo "nixpi-firstboot: AI model already downloaded"
            ;;
        activating)
            echo "nixpi-firstboot: AI model download in progress (background)"
            echo "nixpi-firstboot: track with: journalctl -fu localai-download"
            ;;
        failed)
            echo "nixpi-firstboot: AI model download failed — retry with: systemctl restart localai-download" >&2
            return 1
            ;;
        *)
            echo "nixpi-firstboot: starting AI model download in background..."
            run_root_command systemctl start --no-block localai-download.service || true
            echo "nixpi-firstboot: track with: journalctl -fu localai-download"
            ;;
    esac
    mark_done_with localai "download-started"
}

firstboot_ai_defaults() {
    local settings_path="$PI_DIR/agent/settings.json"
    mkdir -p "$(dirname "$settings_path")"
    cat > "$settings_path" <<'EOF'
{
  "packages": [
    "/usr/local/share/nixpi"
  ],
  "defaultProvider": "localai",
  "defaultModel": "omnicoder-9b-q4_k_m",
  "defaultThinkingLevel": "medium"
}
EOF
    chmod 600 "$settings_path"
}

firstboot_repo_clone() {
    local repo_dir="$HOME/.nixpi/pi-nixpi"
    if [[ -d "$repo_dir/.git" ]]; then
        return 0
    fi
    mkdir -p "$(dirname "$repo_dir")"
    if ! curl -fsI --connect-timeout 5 https://github.com >/dev/null 2>&1; then
        echo "nixpi-firstboot: skipping repo clone until network is available"
        return 0
    fi
    if timeout 30 git clone --depth 1 https://github.com/alexradunet/nixPI.git "$repo_dir"; then
        echo "nixpi-firstboot: cloned pi-nixpi repo"
    else
        echo "nixpi-firstboot: repo clone failed (non-fatal)" >&2
    fi
}

firstboot_git_identity() {
    [[ -n "${PREFILL_NAME:-}" ]] || return 0
    git config --global user.name "$PREFILL_NAME"
    if [[ -n "${PREFILL_EMAIL:-}" ]]; then
        git config --global user.email "$PREFILL_EMAIL"
    fi
}

firstboot_prepare_local_state() {
    mkdir -p "$NIXPI_DIR"
    firstboot_ai_defaults
    firstboot_repo_clone
    firstboot_git_identity
}

firstboot_finalize() {
    if [[ "$NONINTERACTIVE_INSTALL" -ne 1 ]]; then
        echo "nixpi-firstboot: interactive setup remains pending"
        return 0
    fi
    # linger is enabled statically via systemd.tmpfiles.rules in the firstboot module
    systemctl --user enable --now pi-daemon.service || \
        echo "nixpi-firstboot: pi-daemon enable failed (non-fatal)" >&2
    touch "$SETUP_COMPLETE"
    echo "nixpi-firstboot: setup complete"
}

main() {
    mkdir -p "$WIZARD_STATE"
    firstboot_prepare_local_state
    step_done localai  || firstboot_localai  || true
    step_done netbird  || firstboot_netbird  || true
    step_done matrix   || firstboot_matrix   || true
    step_done services || firstboot_services || true
    firstboot_finalize
}

main
