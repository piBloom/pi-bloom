#!/usr/bin/env bash
set -euo pipefail

log() {
	printf '[plain-host-deploy] %s\n' "$*" >&2
}

resolve_repo_url() {
	local ref="$1"
	if [[ "$ref" == path:* || "$ref" == github:* || "$ref" == git+* || "$ref" == https://* || "$ref" == ssh://* ]]; then
		printf '%s\n' "$ref"
		return 0
	fi

	if [[ "$ref" == . || "$ref" == /* ]]; then
		printf 'path:%s\n' "$(realpath "$ref")"
		return 0
	fi

	printf '%s\n' "$ref"
}

escape_nix_string() {
	local value="$1"
	value="${value//\\/\\\\}"
	value="${value//\"/\\\"}"
	value="${value//\$/\\\$}"
	value="${value//$'\n'/\\n}"
	printf '%s' "$value"
}

build_deploy_flake() {
	local repo_url="$1"
	local base_attr="$2"
	local hostname="$3"
	local disk="$4"
	local nix_hostname=""
	local nix_disk=""

	nix_hostname="$(escape_nix_string "$hostname")"
	nix_disk="$(escape_nix_string "$disk")"

	cat <<EOF_FLAKE
{
  inputs.nixpi.url = "${repo_url}";

  outputs = { nixpi, ... }: {
    nixosConfigurations.deploy = nixpi.nixosConfigurations.${base_attr}.extendModules {
      modules = [
        ({ lib, ... }: {
          networking.hostName = lib.mkForce "${nix_hostname}";
          disko.devices.disk.main.device = lib.mkForce "${nix_disk}";
        })
      ];
    };
  };
}
EOF_FLAKE
}

run_ovh_deploy() {
	local target_host="$1"
	local disk="$2"
	local hostname="$3"
	local flake_ref="$4"
	shift 4

	local repo_ref=""
	local base_attr=""
	local repo_url=""
	local tmp_dir=""
	local nixos_anywhere_args=()
	local extra_args=("$@")

	if [[ "$flake_ref" != *#* ]]; then
		log "Flake ref must include a nixosConfigurations attribute, for example .#ovh-base"
		return 1
	fi

	repo_ref="${flake_ref%%#*}"
	base_attr="${flake_ref#*#}"
	if [[ "$base_attr" != "ovh-base" ]]; then
		log "Flake ref must target the ovh-base nixosConfigurations profile (for example .#ovh-base)"
		return 1
	fi
	repo_url="$(resolve_repo_url "$repo_ref")"
	tmp_dir="$(mktemp -d)"
	trap 'rm -rf "$tmp_dir"' RETURN

	build_deploy_flake "$repo_url" "$base_attr" "$hostname" "$disk" > "$tmp_dir/flake.nix"

	log "WARNING: destructive install to ${target_host} using disk ${disk}"
	log "Using base configuration ${flake_ref} with target hostname ${hostname}"
	log "nixos-anywhere will install a plain OVH base system only"
	log "After first boot, optionally run nixpi-bootstrap-host on the machine to layer NixPI onto /etc/nixos"

	nixos_anywhere_args=(
		--flake "$tmp_dir#deploy"
		--target-host "$target_host"
	)

	nixos_anywhere_args+=("${extra_args[@]}")

	exec "${NIXPI_NIXOS_ANYWHERE:-nixos-anywhere}" "${nixos_anywhere_args[@]}"
}
