#!/usr/bin/env bash
# setup-wizard.sh — First-boot setup wizard for NixPI.
set -euo pipefail

WIZARD_LOG="$HOME/.nixpi/wizard.log"
mkdir -p "$(dirname "$WIZARD_LOG")"
exec > >(tee -a "$WIZARD_LOG") 2>&1

echo "=== NixPI Wizard Started: $(date) ==="

log() {
	printf '%s\n' "$*"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

WIZARD_STATE="$HOME/.nixpi/wizard-state"
SYSTEM_READY="$WIZARD_STATE/system-ready"
NIXPI_DIR="/srv/nixpi"
NIXPI_CONFIG="${NIXPI_CONFIG_DIR:-${NIXPI_STATE_DIR:-$HOME/.config/nixpi}/services}"
PI_DIR="${NIXPI_PI_DIR:-$HOME/.pi}"
MATRIX_HOMESERVER="http://localhost:6167"
MATRIX_STATE_DIR="$WIZARD_STATE/matrix-state"
LEGACY_SETUP_STATE="$HOME/.nixpi/setup-state.json"
BOOTSTRAP_STATE_DIR="$HOME/.nixpi/bootstrap"
BOOTSTRAP_UPGRADE_STATUS_FILE="${BOOTSTRAP_STATE_DIR}/full-appliance-upgrade.status"
BOOTSTRAP_UPGRADE_LOG_FILE="${BOOTSTRAP_STATE_DIR}/full-appliance-upgrade.log"
NIXPI_BOOTSTRAP_REPO="${NIXPI_BOOTSTRAP_REPO:-https://github.com/alexradunet/nixpi.git}"
NIXPI_BOOTSTRAP_BRANCH="${NIXPI_BOOTSTRAP_BRANCH:-main}"

PREFILL_FILE="$HOME/.nixpi/prefill.env"
if [[ ! -f "$PREFILL_FILE" && -f "/mnt/host-nixpi/prefill.env" ]]; then
	PREFILL_FILE="/mnt/host-nixpi/prefill.env"
fi
if [[ -f "$PREFILL_FILE" ]]; then
	# shellcheck source=/dev/null
	source "$PREFILL_FILE"
fi

NONINTERACTIVE_SETUP=0
if [[ -f "$PREFILL_FILE" ]]; then
	NONINTERACTIVE_SETUP=1
fi

SETUP_LIB="${SETUP_LIB:-${SCRIPT_DIR}/setup-lib.sh}"
if [[ ! -f "$SETUP_LIB" ]]; then
	SETUP_LIB="/run/current-system/sw/bin/setup-lib.sh"
fi
# shellcheck source=setup-lib.sh
source "$SETUP_LIB"
# shellcheck source=wizard-identity.sh
source "${SCRIPT_DIR}/wizard-identity.sh"
# shellcheck source=wizard-matrix.sh
source "${SCRIPT_DIR}/wizard-matrix.sh"
# shellcheck source=wizard-repo.sh
source "${SCRIPT_DIR}/wizard-repo.sh"
# shellcheck source=wizard-promote.sh
source "${SCRIPT_DIR}/wizard-promote.sh"

step_done() { [[ -f "$WIZARD_STATE/$1" ]]; }

has_command() {
	command -v "$1" >/dev/null 2>&1
}

has_systemd_unit() {
	systemctl list-unit-files "$1" >/dev/null 2>&1
}

has_runtime_stack() {
	[[ -d /usr/local/share/nixpi ]] && has_command pi
}

has_matrix_stack() {
	has_systemd_unit continuwuity.service && has_command curl
}

has_service_stack() {
	[[ -f /usr/local/share/nixpi/home-template.html ]] && has_systemd_unit nixpi-home.service && has_systemd_unit nixpi-element-web.service
}

has_git() {
	has_command git
}

has_full_appliance() {
	has_runtime_stack && has_matrix_stack && has_service_stack && has_command chromium
}

configured_primary_user() {
	read_nixos_assignment 'nixpi\.primaryUser' /etc/nixos/nixpi-host.nix /etc/nixos/nixpi-install.nix && return 0
	read_nixos_option_string 'nixpi.primaryUser'
}

configured_hostname() {
	read_nixos_assignment 'networking\.hostName' /etc/nixos/nixpi-host.nix /etc/nixos/nixpi-install.nix && return 0
	read_nixos_option_string 'networking.hostName'
}

read_nixos_assignment() {
	local pattern="$1"
	shift

	local path value
	for path in "$@"; do
		[[ -f "$path" ]] || continue
		value="$(
			grep "$pattern" "$path" 2>/dev/null \
				| sed 's/.*= "\(.*\)".*/\1/' \
				| head -n 1
		)"
		if [[ -n "$value" ]]; then
			printf '%s' "$value"
			return 0
		fi
	done

	return 1
}

read_nixos_option_string() {
	local option_name="$1"
	command -v nixos-option >/dev/null 2>&1 || return 1

	local option_output value
	option_output="$(nixos-option "$option_name" 2>/dev/null || true)"
	[[ -n "$option_output" ]] || return 1

	value="$(
		printf '%s\n' "$option_output" \
			| sed -n 's/^[[:space:]]*Value:[[:space:]]*"\(.*\)"[[:space:]]*$/\1/p' \
			| head -n 1
	)"
	if [[ -n "$value" ]]; then
		printf '%s' "$value"
		return 0
	fi

	value="$(
		printf '%s\n' "$option_output" \
			| awk '
				/^[[:space:]]*Value:[[:space:]]*$/ { capture = 1; next }
				capture && match($0, /"([^"]+)"/, match_value) { print match_value[1]; exit }
				capture && /^[^[:space:]]/ { exit }
			'
	)"
	if [[ -n "$value" ]]; then
		printf '%s' "$value"
		return 0
	fi

	return 1
}

refresh_group_session_if_needed() {
	local target_path="$1"
	[[ "$target_path" == /var/lib/* ]] || return 0

	local probe_path="$target_path"
	while [[ ! -e "$probe_path" && "$probe_path" != "/" ]]; do
		probe_path=$(dirname "$probe_path")
	done
	[[ -e "$probe_path" ]] || return 0
	[[ -w "$probe_path" ]] && return 0

	local required_group current_user group_members wizard_entrypoint escaped_entrypoint
	required_group=$(stat -c '%G' "$probe_path" 2>/dev/null || true)
	[[ -n "$required_group" && "$required_group" != "UNKNOWN" ]] || return 0

	current_user=$(whoami)
	group_members=$(getent group "$required_group" | cut -d: -f4)
	if ! printf '%s\n' "$group_members" | tr ',' '\n' | grep -qx "$current_user"; then
		return 0
	fi

	if ! command -v sg >/dev/null 2>&1; then
		return 0
	fi

	wizard_entrypoint=$(readlink -f "$0" 2>/dev/null || printf '%s' "$0")
	printf -v escaped_entrypoint '%q' "$wizard_entrypoint"

	echo "Refreshing the setup session to pick up the ${required_group} group..."
	exec sg "$required_group" -c "$escaped_entrypoint"
}

has_wifi_device() {
	command -v nmcli >/dev/null 2>&1 || return 1
	nmcli -t -f TYPE device status 2>/dev/null | grep -q '^wifi$'
}

wifi_is_active_connection() {
	command -v nmcli >/dev/null 2>&1 || return 1
	nmcli -t -f TYPE,STATE device status 2>/dev/null | grep -Eq '^wifi:connected'
}

apply_wifi_preference() {
	if ! has_wifi_device; then
		log "no WiFi hardware detected, skipping WiFi preference"
		return 0
	fi
	if command -v nixpi-prefer-wifi >/dev/null 2>&1; then
		nixpi-prefer-wifi >/dev/null 2>&1 || true
	fi
}

has_gui_session() {
	[[ -n "${DISPLAY:-}" ]] && return 0
	systemctl is-active --quiet display-manager.service 2>/dev/null || return 1
	[[ -f "$HOME/.Xauthority" ]] || return 1
	return 0
}

main() {
	if [[ -f "$SYSTEM_READY" ]]; then
		return 0
	fi

	if [[ -d "$WIZARD_STATE" ]] && ls "$WIZARD_STATE"/* &>/dev/null; then
		echo "Resuming setup..."
	fi

	step_done welcome || step_welcome
	step_done network || step_network
	step_done locale || step_locale
	step_done password || step_password
	step_done appliance || step_appliance
	refresh_group_session_if_needed "$PI_DIR"
	step_done netbird || step_netbird
	if step_done matrix; then
		:
	elif has_matrix_stack; then
		step_matrix
	else
		mark_done_with matrix "skipped"
	fi
	step_done git || step_git
	step_done ai || step_ai
	step_done services || step_services
	step_done bootc_switch || step_bootc_switch

	finalize
}

main "$@"
