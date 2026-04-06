#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/srv/nixpi"
REPO_URL="${NIXPI_REPO_URL:-https://github.com/alexradunet/nixpi.git}"
BRANCH="${NIXPI_REPO_BRANCH:-main}"
HOSTNAME_VALUE="${NIXPI_HOSTNAME:-$(hostname -s)}"
PRIMARY_USER_VALUE="${NIXPI_PRIMARY_USER:-${SUDO_USER:-human}}"
TIMEZONE_VALUE="${NIXPI_TIMEZONE:-UTC}"
KEYBOARD_VALUE="${NIXPI_KEYBOARD:-us}"

log() {
  printf '[nixpi-bootstrap-vps] %s\n' "$*"
}

run_as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    if [ -x /run/wrappers/bin/sudo ]; then
      /run/wrappers/bin/sudo env "PATH=$PATH" "$@"
      return
    fi

    if command -v sudo >/dev/null 2>&1; then
      local SUDO_BIN
      SUDO_BIN="$(command -v sudo)"
      if [[ "$SUDO_BIN" == /nix/store/*/bin/sudo ]]; then
        log "Detected store-provided sudo at $SUDO_BIN (not setuid root)."
        log "Re-run as root, or use /run/wrappers/bin/sudo if available."
        return 1
      fi
      "$SUDO_BIN" env "PATH=$PATH" "$@"
      return
    fi

    if command -v doas >/dev/null 2>&1; then
      doas env "PATH=$PATH" "$@"
      return
    fi

    log "No usable privilege escalation tool found. Re-run this script as root."
    return 1
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

log "Initializing host-owned /etc/nixos flake"
run_as_root env "NIXPI_NIXPKGS_FLAKE_URL=${NIXPI_NIXPKGS_FLAKE_URL:-}" bash "$REPO_DIR/core/scripts/nixpi-init-host-flake.sh" \
  "$REPO_DIR" \
  "$HOSTNAME_VALUE" \
  "$PRIMARY_USER_VALUE" \
  "$TIMEZONE_VALUE" \
  "$KEYBOARD_VALUE"

log "Running nixos-rebuild switch --flake /etc/nixos --impure"
run_as_root nixos-rebuild switch --flake /etc/nixos --impure
