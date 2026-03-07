#!/usr/bin/env bash
set -euo pipefail

# Bloom first-boot greeting
FIRST_RUN_MARKER="$HOME/.bloom/.initialized"

if [ ! -f "$FIRST_RUN_MARKER" ]; then
    echo ""
    echo "  🌱 Welcome to Bloom"
    echo ""
    echo "  Your personal AI companion is starting for the first time."
    echo "  Pi will guide you through setup — just chat naturally."
    echo ""
    echo "  What Pi will help you configure:"
    echo "    • LLM API key (Anthropic, OpenAI, etc.)"
    echo "    • GitHub authentication (for self-evolution)"
    echo "    • Optional OCI service modules:"
    echo "      - Syncthing (home directory sync)"
    echo "      - WhatsApp bridge"
    echo "      - Whisper transcription"
    echo "      - NetBird remote access"
    echo "    • Your preferences and name"
    echo ""

    # Create marker
    mkdir -p "$(dirname "$FIRST_RUN_MARKER")"
    touch "$FIRST_RUN_MARKER"
else
    echo ""
    echo "  🌸 Bloom"
    echo ""
fi
