#!/bin/bash
# detect-display.sh — Auto-detect GPU or headless mode for Sway.
# Writes environment variables to /run/bloom/display-env.
# Called as ExecStartPre from bloom-sway.service.

set -euo pipefail

ENV_FILE="/run/bloom/display-env"
mkdir -p "$(dirname "$ENV_FILE")"

if [ -d /dev/dri ] && ls /dev/dri/renderD* >/dev/null 2>&1; then
    # Real GPU available — use DRM backend
    echo "# GPU detected — using DRM backend" > "$ENV_FILE"
    echo "WLR_BACKENDS=drm" >> "$ENV_FILE"
else
    # No GPU — headless virtual framebuffer
    echo "# No GPU — using headless backend" > "$ENV_FILE"
    echo "WLR_BACKENDS=headless" >> "$ENV_FILE"
    echo "WLR_LIBINPUT_NO_DEVICES=1" >> "$ENV_FILE"
fi
