#!/usr/bin/env bash
set -euo pipefail

SCRIPT_PATH="${1:?installer script path required}"

source "$SCRIPT_PATH"

require_tty() {
  :
}

assert_contains() {
  local needle="$1"
  local path="$2"
  grep -F -- "$needle" "$path" >/dev/null
}

PRIMARY_PASSWORD_VALUE=""
FORCE_YES=0
prompt_password <<< $'pass123\npass123\n'
[[ "$PRIMARY_PASSWORD_VALUE" == "pass123" ]]

PRIMARY_PASSWORD_VALUE=""
FORCE_YES=1
if ( prompt_password ) 2>/dev/null; then
  echo "prompt_password should fail when --yes is used without --password" >&2
  exit 1
fi

USAGE_OUTPUT="$(usage)"
assert_contains "destructive UEFI install" <(printf '%s\n' "$USAGE_OUTPUT")
assert_contains "first-boot setup" <(printf '%s\n' "$USAGE_OUTPUT")

assert_contains 'nixos-generate-config --root "$ROOT_MOUNT"' "$SCRIPT_PATH"
if grep -F -- '--no-filesystems' "$SCRIPT_PATH" >/dev/null; then
  echo "installer script must not generate a filesystem-less hardware config" >&2
  exit 1
fi
