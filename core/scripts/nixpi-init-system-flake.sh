#!/usr/bin/env bash
set -euo pipefail

cat >&2 <<'EOF'
nixpi-init-system-flake.sh has been removed.
NixPI no longer generates /etc/nixos/flake.nix at boot.
Install the final host configuration directly with nixos-anywhere instead.
EOF
exit 1
