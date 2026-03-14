#!/usr/bin/env bash
set -euo pipefail

STATUS_DIR="${HOME}/.bloom"
STATUS_FILE="${STATUS_DIR}/update-status.json"

mkdir -p "$STATUS_DIR"

CHECKED=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

if bootc upgrade --check 2>/dev/null; then
    VERSION=$(bootc status --json 2>/dev/null | jq -r '.status.staged // empty' || echo "")
    AVAILABLE=true
else
    VERSION=""
    AVAILABLE=false
fi

# Preserve notified and staged flags if status file already exists
NOTIFIED=false
STAGED=false
if [[ -f "$STATUS_FILE" ]]; then
    PREV_NOTIFIED=$(jq -r '.notified // false' "$STATUS_FILE" 2>/dev/null || echo "false")
    PREV_STAGED=$(jq -r '.staged // false' "$STATUS_FILE" 2>/dev/null || echo "false")
    if [[ "$AVAILABLE" = "true" ]]; then
        NOTIFIED=$PREV_NOTIFIED
        STAGED=$PREV_STAGED
    fi
fi

cat > "$STATUS_FILE" <<EOF
{"checked": "$CHECKED", "available": $AVAILABLE, "version": "$VERSION", "notified": $NOTIFIED, "staged": $STAGED}
EOF
