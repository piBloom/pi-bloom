#!/usr/bin/env bash
set -euo pipefail

# Bloom login script — ensures Pi settings include Bloom package.

BLOOM_PKG="/usr/local/share/bloom"
PI_SETTINGS="$HOME/.pi/agent/settings.json"
PI_AUTH="$HOME/.pi/agent/auth.json"

pi_ai_ready() {
	[[ -f "$PI_AUTH" ]] || return 1
	[[ -f "$PI_SETTINGS" ]] || return 1
	grep -q '"defaultProvider"[[:space:]]*:' "$PI_SETTINGS" || return 1
	grep -q '"defaultModel"[[:space:]]*:' "$PI_SETTINGS" || return 1
}

# Ensure Pi settings include the Bloom package (idempotent)
if [[ -d "$BLOOM_PKG" ]]; then
    mkdir -p "$(dirname "$PI_SETTINGS")"
    if [[ -f "$PI_SETTINGS" ]]; then
        if command -v jq >/dev/null 2>&1; then
            if ! jq -e '.packages // [] | index("'"$BLOOM_PKG"'")' "$PI_SETTINGS" >/dev/null 2>&1; then
                jq '.packages = ((.packages // []) + ["'"$BLOOM_PKG"'"] | unique)' "$PI_SETTINGS" > "${PI_SETTINGS}.tmp" && \
                    mv "${PI_SETTINGS}.tmp" "$PI_SETTINGS"
            fi
        fi
    else
        cp "$BLOOM_PKG/.pi/agent/settings.json" "$PI_SETTINGS"
    fi
fi

# Start the Matrix daemon once Pi has enough AI config to answer requests.
if pi_ai_ready; then
    if ! systemctl --user --quiet is-active pi-daemon.service 2>/dev/null; then
        systemctl --user enable --now pi-daemon.service >/dev/null 2>&1 || true
    fi
fi
