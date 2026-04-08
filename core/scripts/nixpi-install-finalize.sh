#!/usr/bin/env bash
set -euo pipefail

cat >&2 <<'EOF'
nixpi-install-finalize.sh has been removed.
Install the final host configuration directly with nixos-anywhere.
NixPI no longer seeds /srv/nixpi or generates /etc/nixos/flake.nix at boot.
EOF
exit 1
