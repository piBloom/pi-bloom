#!/usr/bin/env bash
# bootstrap-keys.sh — SSH authorised key loading
set -euo pipefail

read_authorized_keys_file() {
	local source_file="$1"
	local -n _keys_ref="$2"
	local line=""

	while IFS= read -r line || [[ -n "$line" ]]; do
		if [[ "$line" =~ ^(ssh|ecdsa|sk)-[^[:space:]]+[[:space:]]+.+$ ]]; then
			_keys_ref+=("$line")
		fi
	done <"$source_file"
}

load_authorized_keys() {
	local authorized_key="$1"
	local authorized_key_file="$2"
	local -n _keys_out="$3"
	_keys_out=()

	if [[ -n "$authorized_key" && -n "$authorized_key_file" ]]; then
		log "Use either --authorized-key or --authorized-key-file, not both."
		exit 1
	fi

	if [[ -n "$authorized_key" ]]; then
		_keys_out+=("$authorized_key")
		return 0
	fi

	if [[ -n "$authorized_key_file" ]]; then
		if [[ ! -f "$authorized_key_file" ]]; then
			log "--authorized-key-file must point to an existing file."
			exit 1
		fi
		read_authorized_keys_file "$authorized_key_file" _keys_out
		return 0
	fi

	if [[ -f /root/.ssh/authorized_keys ]]; then
		read_authorized_keys_file /root/.ssh/authorized_keys _keys_out
	fi
}
