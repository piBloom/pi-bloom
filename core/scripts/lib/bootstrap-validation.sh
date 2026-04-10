#!/usr/bin/env bash
# bootstrap-validation.sh — pre-flight checks
set -euo pipefail

require_writable_helper_path() {
	local output_path="$1"
	local force_overwrite="$2"

	if [[ "$force_overwrite" == "true" || ! -e "$output_path" ]]; then
		return 0
	fi

	log "Refusing to overwrite existing ${output_path}."
	log "Review the file and rerun with --force if you want nixpi-bootstrap-host to replace it."
	return 1
}

ensure_host_tree_prerequisites() {
	local etc_nixos_dir="$1"

	if [[ ! -f "${etc_nixos_dir}/hardware-configuration.nix" ]]; then
		log "hardware-configuration.nix is required at ${etc_nixos_dir}/hardware-configuration.nix."
		log "Generate it first with nixos-generate-config --dir ${etc_nixos_dir}."
		exit 1
	fi

	if [[ ! -f "${etc_nixos_dir}/configuration.nix" ]]; then
		write_generated_configuration "${etc_nixos_dir}/configuration.nix"
	fi
}

print_manual_integration_instructions() {
	local nixpi_input_escaped="$1"

	cat <<EOF_MANUAL
Manual integration required: /etc/nixos/flake.nix already exists.

1. Add the NixPI input:
   inputs.nixpi.url = "${nixpi_input_escaped}";
   inputs.nixpi.inputs.nixpkgs.follows = "nixpkgs";

2. Ensure your nixosSystem passes the NixPI input:
   specialArgs = { inherit nixpi; };

3. Add the generated helper module to your host's modules list:
   ./nixpi-integration.nix

4. Rebuild manually:
   sudo nixos-rebuild switch --flake /etc/nixos#nixos --impure
EOF_MANUAL
}
