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
    echo "      - WhatsApp or Signal bridge"
    echo "      - Local LLM + speech-to-text"
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
        echo "  How would you like to authenticate?"
        echo "    1) Browser login (a URL will be displayed)"
        echo "    2) Setup key (from https://app.netbird.io → Setup Keys)"
        echo "    3) Skip for now"
        echo ""
        read -rp "  Choose [1/2/3]: " nb_choice
        echo ""

        case "$nb_choice" in
            2)
                read -rp "  Enter your NetBird setup key: " nb_setup_key
                echo ""
                if [ -n "$nb_setup_key" ]; then
                    sudo netbird up --setup-key "$nb_setup_key" 2>&1 || true
                else
                    echo "  No key entered. Skipping NetBird setup."
                    echo "  You can retry later with: sudo netbird up"
                    echo ""
                fi
                ;;
            1)
                # Capture netbird output to extract the auth URL and open it in Chromium
                nb_output=$(sudo netbird up 2>&1) || true
                echo "$nb_output"
                nb_url=$(echo "$nb_output" | grep -oP 'https://[^\s]+' | head -1)
                if [ -n "$nb_url" ]; then
                    echo ""
                    echo "  Opening browser for NetBird login..."
                    setsid chromium "$nb_url" >/dev/null 2>&1 &
                fi
                echo ""
                # Wait for connection (poll every 3s, timeout after 5 minutes)
                echo "  Waiting for NetBird to connect..."
                for i in $(seq 1 100); do
                    if sudo netbird status 2>/dev/null | grep -q "Connected"; then
                        break
                    fi
                    sleep 3
                done
                ;;
            *)
                echo "  Skipping NetBird setup."
                echo "  You can connect later with: sudo netbird up"
                echo ""
                ;;
        esac

        if [ "$nb_choice" = "1" ] || [ "$nb_choice" = "2" ]; then
            if sudo netbird status 2>/dev/null | grep -q "Connected"; then
                echo "  NetBird connected successfully!"
                echo ""
            else
                echo "  NetBird not yet connected. You can retry later with: sudo netbird up"
                echo ""
            fi
        fi
    fi
fi
