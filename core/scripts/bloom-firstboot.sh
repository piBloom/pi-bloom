#!/usr/bin/env bash
# bloom-firstboot.sh — Non-interactive first-boot preparation for Bloom OS.
# Runs before getty via bloom-firstboot.service as the primary Bloom user.
# If ~/.bloom/prefill.env is present, first boot completes unattended; otherwise
# it performs background preparation and leaves the interactive wizard pending.
# On failure, exits 1 (non-fatal per SuccessExitStatus). User can re-run
# bloom-wizard.sh on next login to resume from the last incomplete checkpoint.
set -euo pipefail

# Logging setup - log to file for debugging
FIRSTBOOT_LOG="$HOME/.bloom/firstboot.log"
mkdir -p "$(dirname "$FIRSTBOOT_LOG")"
exec > >(tee -a "$FIRSTBOOT_LOG") 2>&1

echo "=== Bloom Firstboot Started: $(date) ==="

WIZARD_STATE="$HOME/.bloom/wizard-state"
SETUP_COMPLETE="$HOME/.bloom/.setup-complete"
BLOOM_DIR="${BLOOM_DIR:-$HOME/Bloom}"
SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
BLOOM_CONFIG="$HOME/.config/bloom"
PI_DIR="$HOME/.pi"
MATRIX_HOMESERVER="http://localhost:6167"
MATRIX_STATE_DIR="$WIZARD_STATE/matrix-state"

PREFILL_FILE="$HOME/.bloom/prefill.env"
if [[ -f "$PREFILL_FILE" ]]; then
    # shellcheck source=/dev/null
    source "$PREFILL_FILE"
fi

NONINTERACTIVE_INSTALL=0
if [[ -f "$PREFILL_FILE" ]]; then
    NONINTERACTIVE_INSTALL=1
fi

# Load shared function library.
# bloom-firstboot.sh is run directly from the Nix source tree (not via bloom-app),
# so $(dirname "$0") points into the source store, not bloom-app's $out/bin/.
# The dirname probe is kept for pattern consistency but will always fall through
# to the /run/current-system/sw/bin fallback at runtime.
BLOOM_LIB="$(dirname "$0")/bloom-lib.sh"
if [[ ! -f "$BLOOM_LIB" ]]; then
    BLOOM_LIB="/run/current-system/sw/bin/bloom-lib.sh"
fi
# shellcheck source=bloom-lib.sh
source "$BLOOM_LIB"

step_done() { [[ -f "$WIZARD_STATE/$1" ]]; }

# --- First-boot steps ---

firstboot_netbird() {
    [[ -z "${PREFILL_NETBIRD_KEY:-}" ]] && { echo "bloom-firstboot: no NetBird key, skipping"; return 0; }
    echo "bloom-firstboot: connecting to NetBird..."
    if ! systemctl is-active --quiet netbird.service; then
        sudo systemctl start netbird.service
    fi
    local wait_count=0
    while [[ ! -S /var/run/netbird/sock ]]; do
        wait_count=$((wait_count + 1))
        [[ $wait_count -ge 20 ]] && { echo "bloom-firstboot: NetBird daemon did not start" >&2; return 1; }
        sleep 0.5
    done
    if sudo netbird up --setup-key "$PREFILL_NETBIRD_KEY"; then
        sleep 3
        local mesh_ip
        mesh_ip=$(netbird status 2>/dev/null | grep -oP 'NetBird IP:\s+\K[\d.]+' || true)
        [[ -n "$mesh_ip" ]] && mark_done_with netbird "$mesh_ip"
        echo "bloom-firstboot: NetBird connected (${mesh_ip:-unknown IP})"
    else
        echo "bloom-firstboot: NetBird connection failed" >&2
        return 1
    fi
}

firstboot_matrix() {
    [[ -z "${PREFILL_USERNAME:-}" ]] && { echo "bloom-firstboot: no Matrix username, skipping"; return 0; }
    echo "bloom-firstboot: setting up Matrix..."
    # Poll until homeserver accepts connections (up to 60s)
    local attempts=0
    until curl -sf "http://localhost:6167/_matrix/client/versions" >/dev/null 2>&1; do
        attempts=$((attempts + 1))
        [[ $attempts -ge 60 ]] && { echo "bloom-firstboot: Matrix homeserver not ready after 60s" >&2; return 1; }
        sleep 1
    done
    echo "bloom-firstboot: Matrix homeserver ready"
    # Delegate to wizard's step_matrix (reads PREFILL_USERNAME from env)
    step_matrix
}

firstboot_services() {
    echo "bloom-firstboot: provisioning Bloom Home..."
    local mesh_ip mesh_fqdn
    mesh_ip=$(read_checkpoint_data netbird)
    mesh_fqdn=$(netbird_fqdn)
    write_fluffychat_runtime_config
    write_service_home_runtime "$mesh_ip" "$mesh_fqdn"
    install_home_infrastructure || echo "bloom-firstboot: Bloom Home setup failed (non-fatal)"
    systemctl --user restart bloom-fluffychat.service || echo "bloom-firstboot: fluffychat restart failed (non-fatal)" >&2
    systemctl --user restart bloom-dufs.service || echo "bloom-firstboot: dufs restart failed (non-fatal)" >&2
    systemctl --user restart bloom-code-server.service || echo "bloom-firstboot: code-server restart failed (non-fatal)" >&2
    mark_done_with services "fluffychat dufs code-server"
}

firstboot_localai() {
    # localai-download.service starts automatically (localai.service requires it).
    # This step surfaces the status so it appears in the firstboot log.
    local state
    state=$(systemctl is-active localai-download.service 2>/dev/null || true)
    case "$state" in
        active)
            echo "bloom-firstboot: AI model already downloaded"
            ;;
        activating)
            echo "bloom-firstboot: AI model download in progress (background)"
            echo "bloom-firstboot: track with: sudo journalctl -fu localai-download"
            ;;
        failed)
            echo "bloom-firstboot: AI model download failed — retry with: sudo systemctl restart localai-download" >&2
            return 1
            ;;
        *)
            echo "bloom-firstboot: starting AI model download in background..."
            sudo systemctl start --no-block localai-download.service || true
            echo "bloom-firstboot: track with: sudo journalctl -fu localai-download"
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
    "/usr/local/share/bloom"
  ],
  "defaultProvider": "localai",
  "defaultModel": "omnicoder-9b-q4_k_m",
  "defaultThinkingLevel": "medium"
}
EOF
    chmod 600 "$settings_path"
}

firstboot_repo_clone() {
    local repo_dir="$HOME/.bloom/pi-bloom"
    if [[ -d "$repo_dir/.git" ]]; then
        return 0
    fi
    mkdir -p "$(dirname "$repo_dir")"
    if ! curl -fsI --connect-timeout 5 https://github.com >/dev/null 2>&1; then
        echo "bloom-firstboot: skipping repo clone until network is available"
        return 0
    fi
    if timeout 30 git clone --depth 1 https://github.com/alexradunet/piBloom.git "$repo_dir"; then
        echo "bloom-firstboot: cloned pi-bloom repo"
    else
        echo "bloom-firstboot: repo clone failed (non-fatal)" >&2
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
    firstboot_ai_defaults
    firstboot_repo_clone
    firstboot_git_identity
}

firstboot_finalize() {
    if [[ "$NONINTERACTIVE_INSTALL" -ne 1 ]]; then
        echo "bloom-firstboot: interactive setup remains pending"
        return 0
    fi
    # linger is enabled statically via systemd.tmpfiles.rules in bloom-firstboot.nix
    systemctl --user enable --now pi-daemon.service || \
        echo "bloom-firstboot: pi-daemon enable failed (non-fatal)" >&2
    touch "$SETUP_COMPLETE"
    echo "bloom-firstboot: setup complete"
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
