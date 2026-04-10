#!/usr/bin/env bash
# bootstrap-utils.sh — shared logging and string utilities
set -euo pipefail

log() {
	printf '%s\n' "$*" >&2
}

escape_nix_string() {
	local value="${1-}"

	value="${value//\\/\\\\}"
	value="${value//\"/\\\"}"
	value="${value//$'\n'/\\n}"
	value="${value//$'\r'/\\r}"
	value="${value//\$\{/\\\$\{}"

	printf '%s' "$value"
}

usage() {
	cat <<'EOF_USAGE'
Usage: nixpi-bootstrap-host --primary-user USER --ssh-allowed-cidr CIDR [--ssh-allowed-cidr CIDR ...]
  [--hostname HOSTNAME] [--timezone TZ] [--keyboard LAYOUT] [--nixpi-input FLAKE_REF]
  [--authorized-key KEY | --authorized-key-file PATH] [--force]

Bootstrap NixPI onto an already-installed NixOS host by writing narrow /etc/nixos helper files.
If /etc/nixos/flake.nix does not exist, a minimal host flake is generated automatically.
If /etc/nixos/flake.nix already exists, helper files are written and exact manual integration instructions are printed.
EOF_USAGE
}
