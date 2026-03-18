#!/usr/bin/env bash
# bloom-firstboot.sh — Non-interactive first-boot automation for Bloom OS.
# Runs once before getty via bloom-firstboot.service (User=pi).
# Reads ~/.bloom/prefill.env written by the Calamares bloom_prefill module.
# On failure, exits 1 (non-fatal per SuccessExitStatus). User can re-run
# bloom-wizard.sh on next login to resume from the last incomplete checkpoint.
set -euo pipefail

WIZARD_STATE="$HOME/.bloom/wizard-state"
SETUP_COMPLETE="$HOME/.bloom/.setup-complete"
BLOOM_DIR="${BLOOM_DIR:-$HOME/Bloom}"
BLOOM_SERVICES="/usr/local/share/bloom/services"
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

# Re-use all helper functions from bloom-wizard.sh to avoid duplication.
# When running from the Nix store (via bloom-firstboot.service), dirname "$0" is a store
# path without bloom-wizard.sh. Fall back to the system PATH install location.
# shellcheck source=bloom-wizard.sh
WIZARD_SCRIPT="$(dirname "$0")/bloom-wizard.sh"
if [[ ! -f "$WIZARD_SCRIPT" ]]; then
    WIZARD_SCRIPT="/run/current-system/sw/bin/bloom-wizard.sh"
fi
# Source only the function definitions (skip main() execution) by setting a guard.
BLOOM_FIRSTBOOT_SOURCING=1
source "$WIZARD_SCRIPT"
unset BLOOM_FIRSTBOOT_SOURCING

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
    local installed=""
    local mesh_ip mesh_fqdn
    mesh_ip=$(read_checkpoint_data netbird)
    mesh_fqdn=$(netbird_fqdn)
    write_service_home_runtime "$installed" "$mesh_ip" "$mesh_fqdn"
    install_home_infrastructure || echo "bloom-firstboot: Bloom Home setup failed (non-fatal)"

    if [[ -n "${PREFILL_SERVICES:-}" ]]; then
        IFS=',' read -ra svc_list <<< "$PREFILL_SERVICES"
        for svc in "${svc_list[@]}"; do
            svc="$(echo "$svc" | xargs)"
            [[ -z "$svc" ]] && continue
            echo "bloom-firstboot: installing service: $svc"
            if install_service "$svc"; then
                installed="${installed} ${svc}"
                write_service_home_runtime "$installed" "$mesh_ip" "$mesh_fqdn"
            else
                echo "bloom-firstboot: service $svc failed (non-fatal)" >&2
            fi
        done
    fi

    write_service_home_runtime "$installed" "$mesh_ip" "$mesh_fqdn"
    mark_done_with services "${installed:-none}"
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

firstboot_finalize() {
    # linger is enabled statically via systemd.tmpfiles.rules in bloom-firstboot.nix
    systemctl --user enable --now pi-daemon.service || \
        echo "bloom-firstboot: pi-daemon enable failed (non-fatal)" >&2
    touch "$SETUP_COMPLETE"
    echo "bloom-firstboot: setup complete"
}

main() {
    mkdir -p "$WIZARD_STATE"
    step_done localai  || firstboot_localai  || true
    step_done netbird  || firstboot_netbird  || true
    step_done matrix   || firstboot_matrix   || true
    step_done services || firstboot_services || true
    firstboot_finalize
}

main
