#!/usr/bin/env bash
# bootstrap-files.sh — Nix file writers
set -euo pipefail

write_host_module() {
	local output_path="$1"
	local hostname="$2"
	local primary_user="$3"
	local timezone="$4"
	local keyboard="$5"
	shift 5
	local -a authorized_keys=("$@")

	local hostname_escaped primary_user_escaped timezone_escaped keyboard_escaped
	hostname_escaped="$(escape_nix_string "$hostname")"
	primary_user_escaped="$(escape_nix_string "$primary_user")"
	timezone_escaped="$(escape_nix_string "$timezone")"
	keyboard_escaped="$(escape_nix_string "$keyboard")"

	local authorized_keys_block="" ssh_allowed_cidrs_block=""

	if [[ "${#authorized_keys[@]}" -gt 0 ]]; then
		authorized_keys_block=$'\n'"  users.users.${primary_user}.openssh.authorizedKeys.keys = ["
		for key in "${authorized_keys[@]}"; do
			authorized_keys_block+=$'\n'"    \"$(escape_nix_string "$key")\""
		done
		authorized_keys_block+=$'\n'"  ];"
	fi

	# ssh_allowed_cidrs is set in main and accessed directly here
	ssh_allowed_cidrs_block=$'\n'"  nixpi.security.ssh.allowedSourceCIDRs = ["
	for cidr in "${ssh_allowed_cidrs[@]}"; do
		ssh_allowed_cidrs_block+=$'\n'"    \"$(escape_nix_string "$cidr")\""
	done
	ssh_allowed_cidrs_block+=$'\n'"  ];"

	cat >"$output_path" <<EOF_HOST
{ ... }:
{
  networking.hostName = "${hostname_escaped}";
  nixpi.bootstrap.enable = true;
  nixpi.primaryUser = "${primary_user_escaped}";
  nixpi.timezone = "${timezone_escaped}";
  nixpi.keyboard = "${keyboard_escaped}";
${ssh_allowed_cidrs_block}
${authorized_keys_block}
}
EOF_HOST
}

write_integration_module() {
	local output_path="$1"

	cat >"$output_path" <<'EOF_INTEGRATION'
{ nixpi, ... }:
{
  imports = [
    nixpi.nixosModules.nixpi
    ./nixpi-host.nix
  ];
}
EOF_INTEGRATION
}

write_generated_configuration() {
	local output_path="$1"

	cat >"$output_path" <<'EOF_CONFIG'
{ lib, modulesPath, ... }:
{
  imports = [
    (modulesPath + "/profiles/qemu-guest.nix")
  ];

  system.stateVersion = "25.05";

  nix.settings.experimental-features = [
    "nix-command"
    "flakes"
  ];

  networking.firewall.allowedTCPPorts = [ 22 ];

  boot.loader = {
    systemd-boot.enable = lib.mkForce false;
    efi.canTouchEfiVariables = lib.mkForce false;
    grub = {
      enable = true;
      efiSupport = true;
      efiInstallAsRemovable = true;
      device = "nodev";
    };
  };

  services.qemuGuest.enable = lib.mkDefault true;
}
EOF_CONFIG
}

write_generated_flake() {
	local output_path="$1"
	local nixpi_input_escaped="$2"

	cat >"$output_path" <<EOF_FLAKE
{
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";
  inputs.nixpi.url = "${nixpi_input_escaped}";
  inputs.nixpi.inputs.nixpkgs.follows = "nixpkgs";

  outputs = { nixpkgs, nixpi, ... }: {
    nixosConfigurations.nixos = nixpkgs.lib.nixosSystem {
      system = builtins.currentSystem;
      specialArgs = { inherit nixpi; };
      modules = [
        ./configuration.nix
        ./nixpi-integration.nix
        ./hardware-configuration.nix
      ];
    };
  };
}
EOF_FLAKE
}
