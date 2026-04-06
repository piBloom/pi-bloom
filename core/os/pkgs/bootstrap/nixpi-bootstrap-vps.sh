#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/srv/nixpi"
REPO_URL="${NIXPI_REPO_URL:-https://github.com/alexradunet/nixpi.git}"
BRANCH="${NIXPI_REPO_BRANCH:-main}"

log() {
  printf '[nixpi-bootstrap-vps] %s\n' "$*"
}

run_as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    if [ -x /run/wrappers/bin/sudo ]; then
      /run/wrappers/bin/sudo env "PATH=$PATH" "$@"
    else
      sudo env "PATH=$PATH" "$@"
    fi
  fi
}

if [ ! -d "$REPO_DIR/.git" ]; then
  log "Cloning $REPO_URL#$BRANCH into $REPO_DIR"
  run_as_root install -d -m 0755 /srv
  run_as_root git clone --branch "$BRANCH" "$REPO_URL" "$REPO_DIR"
else
  log "Updating existing checkout at $REPO_DIR"
fi

run_as_root git -C "$REPO_DIR" fetch origin "$BRANCH"
run_as_root git -C "$REPO_DIR" checkout "$BRANCH"
run_as_root git -C "$REPO_DIR" reset --hard "origin/$BRANCH"

# Ensure nix experimental features are enabled so nixos-rebuild can use flakes.
# A fresh NixOS host has no experimental-features configured by default.
NIXCONF=/etc/nix/nix.conf
if ! run_as_root grep -q 'experimental-features' "$NIXCONF" 2>/dev/null; then
  log "Enabling nix experimental features in $NIXCONF"
  run_as_root sh -c "echo 'experimental-features = nix-command flakes' >> $NIXCONF"
fi

log "Running nixos-rebuild switch --flake /srv/nixpi#nixpi"
run_as_root nixos-rebuild switch --flake /srv/nixpi#nixpi
