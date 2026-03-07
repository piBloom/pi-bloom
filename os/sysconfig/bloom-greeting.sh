#!/usr/bin/env bash
set -euo pipefail

# Bloom login script — ensures Pi settings include Bloom package, shows greeting,
# and handles NetBird authentication before Pi launches.

BLOOM_PKG="/usr/local/share/bloom"
PI_SETTINGS="$HOME/.pi/agent/settings.json"

# Ensure Pi settings include the Bloom package (idempotent, runs every login)
if [ -d "$BLOOM_PKG" ]; then
    mkdir -p "$(dirname "$PI_SETTINGS")"
    if [ -f "$PI_SETTINGS" ]; then
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

# First-boot greeting
FIRST_RUN_MARKER="$HOME/.bloom/.initialized"

if [ ! -f "$FIRST_RUN_MARKER" ]; then
    echo ""
    echo "  Welcome to Bloom"
    echo ""
    echo "  Your personal AI companion is starting for the first time."
    echo "  Pi will guide you through setup — just chat naturally."
    echo ""
    echo "  What Pi will help you configure:"
    echo "    - Git identity (name and email)"
    echo "    - dufs (home directory WebDAV access)"
    echo "    - Optional services:"
    echo "      - WhatsApp bridge"
    echo "      - Lemonade (local LLM + speech-to-text)"
    echo "    - Your preferences and name"
    echo ""

    mkdir -p "$(dirname "$FIRST_RUN_MARKER")"
    touch "$FIRST_RUN_MARKER"
else
    echo ""
    echo "  Bloom"
    echo ""
fi

# --- NetBird authentication (runs every login until connected) ---
if command -v netbird >/dev/null 2>&1; then
    # Check if NetBird is already connected
    if ! sudo netbird status 2>/dev/null | grep -q "Connected"; then
        echo "  NetBird mesh networking is not connected."
        echo "  This provides secure remote access to your Bloom device."
        echo ""
        echo "  Starting NetBird authentication..."
        echo ""
        # netbird up prints the auth URL for the user to visit
        sudo netbird up 2>&1 || true
        echo ""
        # Wait for connection (poll every 3s, timeout after 5 minutes)
        echo "  Waiting for NetBird to connect (open the URL above in a browser)..."
        for i in $(seq 1 100); do
            if sudo netbird status 2>/dev/null | grep -q "Connected"; then
                echo "  NetBird connected successfully!"
                echo ""
                break
            fi
            sleep 3
        done
        if ! sudo netbird status 2>/dev/null | grep -q "Connected"; then
            echo "  NetBird not yet connected. You can retry later with: sudo netbird up"
            echo ""
        fi
    fi
fi
