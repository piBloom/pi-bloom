#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/srv/nixpi"
REMOTE_BRANCH="${1:-main}"
HOST_FLAKE_ATTR="${NIXPI_OPERATOR_FLAKE_ATTR:-ovh-vps}"

if [ ! -d "$REPO_DIR/.git" ]; then
  echo "nixpi-rebuild-pull manages the conventional /srv/nixpi operator checkout." >&2
  echo "That checkout is optional. Create or restore it first, or use 'sudo nixpi-rebuild' to rebuild the installed /etc/nixos host flake." >&2
  exit 1
fi

git config --global --add safe.directory "$REPO_DIR" >/dev/null 2>&1 || true
git -C "$REPO_DIR" fetch origin
git -C "$REPO_DIR" reset --hard "origin/$REMOTE_BRANCH"

exec nixos-rebuild switch --flake "${REPO_DIR}#${HOST_FLAKE_ATTR}" --impure
