#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${script_dir}/plain-host-ovh-common.sh"

usage() {
	cat <<'EOF_USAGE'
Usage: plain-host-deploy --target-host root@IP --disk /dev/sdX [--flake .#ovh-base] [--hostname HOSTNAME] [extra nixos-anywhere args...]

Destructive plain NixOS base install for an OVH VPS in rescue mode.
Optionally bootstrap NixPI afterward on the installed machine with nixpi-bootstrap-host.

Examples:
  nix run .#plain-host-deploy -- --target-host root@198.51.100.10 --disk /dev/sda
  nix run .#plain-host-deploy -- --target-host root@198.51.100.10 --disk /dev/nvme0n1 --hostname bloom-eu-1
EOF_USAGE
}

main() {
	local target_host=""
	local disk=""
	local hostname="ovh-base"
	local flake_ref="${NIXPI_REPO_ROOT:-.}#ovh-base"
	local extra_args=()

	while [[ $# -gt 0 ]]; do
		case "$1" in
			--target-host)
				target_host="${2:?missing target host}"
				shift 2
				;;
			--disk)
				disk="${2:?missing disk path}"
				shift 2
				;;
			--flake)
				flake_ref="${2:?missing flake ref}"
				shift 2
				;;
			--hostname)
				hostname="${2:?missing hostname}"
				shift 2
				;;
			--bootstrap-user|--bootstrap-user=*|--bootstrap-password-hash|--bootstrap-password-hash=*|--netbird-setup-key-file|--netbird-setup-key-file=*)
				usage >&2
				printf 'Unsupported legacy option: %s. Install the plain ovh-base system, then run nixpi-bootstrap-host after first boot.\n' "${1%%=*}" >&2
				exit 1
				;;
			--help|-h)
				usage
				exit 0
				;;
			*)
				extra_args+=("$1")
				shift
				;;
		esac
	done

	if [[ -z "$target_host" || -z "$disk" ]]; then
		usage >&2
		exit 1
	fi

	run_ovh_deploy "$target_host" "$disk" "$hostname" "$flake_ref" "${extra_args[@]}"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
	main "$@"
fi
