#!/usr/bin/env bash
# nixpi-bootstrap-host — orchestrator
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/bootstrap-utils.sh
source "$SCRIPT_DIR/lib/bootstrap-utils.sh"
# shellcheck source=lib/bootstrap-keys.sh
source "$SCRIPT_DIR/lib/bootstrap-keys.sh"
# shellcheck source=lib/bootstrap-validation.sh
source "$SCRIPT_DIR/lib/bootstrap-validation.sh"
# shellcheck source=lib/bootstrap-files.sh
source "$SCRIPT_DIR/lib/bootstrap-files.sh"

main() {
	local etc_nixos_dir="${NIXPI_BOOTSTRAP_ROOT:-/etc/nixos}"
	local nixos_rebuild_bin="${NIXPI_NIXOS_REBUILD:-nixos-rebuild}"
	local primary_user="" hostname="nixos" timezone="UTC" keyboard="us"
	local nixpi_input="${NIXPI_DEFAULT_INPUT:-github:alexradunet/nixpi}"
	local authorized_key="" authorized_key_file="" force_overwrite="false"
	# ssh_allowed_cidrs is NOT local: bootstrap-files.sh write_host_module reads it directly.
	ssh_allowed_cidrs=()
	local -a authorized_keys=()

	while [[ $# -gt 0 ]]; do
		case "$1" in
			--primary-user)        primary_user="${2:?missing primary user}"; shift 2 ;;
			--hostname)            hostname="${2:?missing hostname}"; shift 2 ;;
			--timezone)            timezone="${2:?missing timezone}"; shift 2 ;;
			--keyboard)            keyboard="${2:?missing keyboard layout}"; shift 2 ;;
			--nixpi-input)         nixpi_input="${2:?missing nixpi input}"; shift 2 ;;
			--authorized-key)      authorized_key="${2:?missing authorized key}"; shift 2 ;;
			--authorized-key-file) authorized_key_file="${2:?missing authorized key file}"; shift 2 ;;
			--ssh-allowed-cidr)    ssh_allowed_cidrs+=("${2:?missing SSH allowed CIDR}"); shift 2 ;;
			--force)               force_overwrite="true"; shift ;;
			--help|-h)             usage; exit 0 ;;
			*)                     usage >&2; exit 1 ;;
		esac
	done

	[[ -n "$primary_user" ]] || { usage >&2; exit 1; }
	[[ "${#ssh_allowed_cidrs[@]}" -gt 0 ]] || { log "At least one --ssh-allowed-cidr value is required."; exit 1; }

	if [[ "$etc_nixos_dir" != "/etc/nixos" && "$nixos_rebuild_bin" == "nixos-rebuild" ]]; then
		log "NIXPI_BOOTSTRAP_ROOT is for tests/staging only when it differs from /etc/nixos."
		log "Refusing to use NIXPI_BOOTSTRAP_ROOT=${etc_nixos_dir} with the default nixos-rebuild because rebuild/manual instructions target /etc/nixos#nixos."
		log "Unset NIXPI_BOOTSTRAP_ROOT for a real host bootstrap, or set NIXPI_NIXOS_REBUILD to a staging/test stub."
		exit 1
	fi

	mkdir -p "$etc_nixos_dir"

	if [[ "$force_overwrite" == "true" ]]; then
		rm -f \
			"${etc_nixos_dir}/flake.nix" \
			"${etc_nixos_dir}/flake.lock" \
			"${etc_nixos_dir}/nixpi-host.nix" \
			"${etc_nixos_dir}/nixpi-integration.nix"
	fi

	load_authorized_keys "$authorized_key" "$authorized_key_file" authorized_keys
	ensure_host_tree_prerequisites "$etc_nixos_dir"

	require_writable_helper_path "${etc_nixos_dir}/nixpi-host.nix" "$force_overwrite"
	require_writable_helper_path "${etc_nixos_dir}/nixpi-integration.nix" "$force_overwrite"

	write_host_module "${etc_nixos_dir}/nixpi-host.nix" \
		"$hostname" "$primary_user" "$timezone" "$keyboard" \
		"${authorized_keys[@]+"${authorized_keys[@]}"}"
	write_integration_module "${etc_nixos_dir}/nixpi-integration.nix"

	if [[ -f "${etc_nixos_dir}/flake.nix" ]]; then
		print_manual_integration_instructions "$(escape_nix_string "$nixpi_input")"
		return 0
	fi

	write_generated_flake "${etc_nixos_dir}/flake.nix" "$(escape_nix_string "$nixpi_input")"
	exec "$nixos_rebuild_bin" switch --flake /etc/nixos#nixos --impure
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
	main "$@"
fi
