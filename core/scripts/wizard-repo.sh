#!/usr/bin/env bash
# Repository and appliance-promotion phase helpers for setup-wizard.sh.

has_internet_connection() {
	ping -c1 -W5 1.1.1.1 &>/dev/null
}

bootstrap_repo_is_local() {
	[[ "$NIXPI_BOOTSTRAP_REPO" == file://* ]] || [[ "$NIXPI_BOOTSTRAP_REPO" == /* ]]
}

write_appliance_status() {
	install -d -m 0755 "$BOOTSTRAP_STATE_DIR"
	printf '%s %s\n' "$(date -Iseconds)" "$1" > "$BOOTSTRAP_UPGRADE_STATUS_FILE"
	chmod 0644 "$BOOTSTRAP_UPGRADE_STATUS_FILE"
}

print_recent_appliance_log() {
	if [[ ! -r "$BOOTSTRAP_UPGRADE_LOG_FILE" ]]; then
		return
	fi

	local recent_log
	recent_log=$(tail -n 10 "$BOOTSTRAP_UPGRADE_LOG_FILE" 2>/dev/null || true)
	[[ -n "$recent_log" ]] || return

	echo "Recent appliance promotion log:"
	while IFS= read -r line; do
		echo "  $line"
	done <<< "$recent_log"
}

clone_nixpi_checkout() {
	local primary_user="$1"
	local actual_remote actual_branch repo_preexisted=0

	if [[ -z "$primary_user" ]]; then
		echo "Configured primary user is required before preparing the canonical repo checkout." >&2
		return 1
	fi

	if [[ -e "$NIXPI_DIR" ]]; then
		repo_preexisted=1
	fi

	if [[ -d "$NIXPI_DIR/.git" ]]; then
		actual_remote="$(git -C "$NIXPI_DIR" remote get-url origin 2>/dev/null || true)"
		if [[ "$actual_remote" != "$NIXPI_BOOTSTRAP_REPO" ]]; then
			echo "Existing checkout has unexpected origin URL: ${actual_remote:-<missing>} (expected ${NIXPI_BOOTSTRAP_REPO})" >&2
			return 1
		fi

		actual_branch="$(git -C "$NIXPI_DIR" branch --show-current 2>/dev/null || true)"
		if [[ "$actual_branch" != "$NIXPI_BOOTSTRAP_BRANCH" ]]; then
			echo "Existing checkout is on branch ${actual_branch:-<detached>} (expected ${NIXPI_BOOTSTRAP_BRANCH})" >&2
			return 1
		fi

		echo "Using existing checkout at ${NIXPI_DIR}."
		return 0
	fi

	if [[ "$repo_preexisted" -eq 1 ]]; then
		echo "canonical repo checkout is missing .git: ${NIXPI_DIR}" >&2
		return 1
	fi

	root_command /run/current-system/sw/bin/nixpi-bootstrap-ensure-repo-target "$NIXPI_DIR" "$primary_user"
	if [[ ! -d "$NIXPI_DIR" ]] || [[ ! -w "$NIXPI_DIR" ]]; then
		echo "Canonical repo target is not writable: ${NIXPI_DIR}" >&2
		return 1
	fi
	if command -v git >/dev/null 2>&1; then
		git clone --branch "$NIXPI_BOOTSTRAP_BRANCH" "$NIXPI_BOOTSTRAP_REPO" "$NIXPI_DIR"
	else
		nix --extra-experimental-features 'nix-command flakes' run nixpkgs#git -- clone --branch "$NIXPI_BOOTSTRAP_BRANCH" "$NIXPI_BOOTSTRAP_REPO" "$NIXPI_DIR"
	fi
}

promote_full_appliance() {
	local hostname="$1"
	local primary_user="$2"

	install -d -m 0755 "$BOOTSTRAP_STATE_DIR"
	: > "$BOOTSTRAP_UPGRADE_LOG_FILE"

	write_appliance_status "Cloning the NixPI checkout..."
	if ! clone_nixpi_checkout "$primary_user" 2>&1 | tee -a "$BOOTSTRAP_UPGRADE_LOG_FILE"; then
		write_appliance_status "Failed to prepare the NixPI checkout."
		return 1
	fi

	write_appliance_status "Preparing the canonical /srv/nixpi checkout..."
	if ! root_command nixpi-bootstrap-prepare-repo "$NIXPI_DIR" "$NIXPI_BOOTSTRAP_REPO" "$NIXPI_BOOTSTRAP_BRANCH" "$primary_user" 2>&1 | tee -a "$BOOTSTRAP_UPGRADE_LOG_FILE"; then
		write_appliance_status "Failed to prepare the canonical /srv/nixpi checkout."
		return 1
	fi

	if bootstrap_repo_is_local; then
		write_appliance_status "Canonical repo prepared from local source. Rebuild deferred."
		return 0
	fi

	write_appliance_status "Building and activating the full NixPI appliance..."
	if ! root_command nixpi-bootstrap-nixos-rebuild-switch 2>&1 | tee -a "$BOOTSTRAP_UPGRADE_LOG_FILE"; then
		write_appliance_status "Promotion failed. Review ${BOOTSTRAP_UPGRADE_LOG_FILE}."
		return 1
	fi

	write_appliance_status "Full NixPI appliance installed successfully."
	return 0
}

step_appliance() {
	echo ""
	echo "--- Appliance Upgrade ---"

	if has_full_appliance; then
		echo "Standard NixPI appliance is already installed."
		mark_done appliance
		return
	fi

	if ! has_internet_connection && ! bootstrap_repo_is_local; then
		if [[ "$NONINTERACTIVE_SETUP" -eq 1 ]]; then
			echo "Internet connection is required before promoting this machine to the full NixPI appliance."
			echo "Deferring appliance upgrade because setup is running in noninteractive mode."
			echo "Connect to WiFi or Ethernet later, then rerun setup-wizard.sh to complete the upgrade."
			mark_done_with appliance "deferred-offline"
			return
		fi
		echo "Internet connection is required before promoting this machine to the full NixPI appliance."
		echo "Connect to WiFi or Ethernet first, then continue setup."
		return 1
	fi

	echo "Promoting this minimal base into the standard NixPI appliance..."
	echo "This can take several minutes on slower hardware."
	echo "A canonical checkout will be cloned into /srv/nixpi."

	local current_hostname current_user configured_user
	current_hostname=$(hostnamectl --static 2>/dev/null || hostname -s)
	current_user=$(whoami)
	configured_user="$(configured_primary_user)" || {
		echo "ERROR: Could not determine the configured primary user before appliance promotion." >&2
		return 1
	}

	if ! promote_full_appliance "$current_hostname" "$configured_user"; then
		echo "Appliance promotion failed. Review ${BOOTSTRAP_UPGRADE_LOG_FILE}." >&2
		print_recent_appliance_log >&2
		return 1
	fi

	echo "Standard NixPI appliance is ready."
	mark_done appliance

	local target_user="$configured_user"
	if [[ -n "$target_user" && "$target_user" != "$current_user" ]]; then
		echo ""
		echo "Appliance promotion switched the primary user from ${current_user} to ${target_user}."
		echo "This terminal is still running under the old bootstrap account."
		echo "Open a new terminal as ${target_user}, then rerun: setup-wizard.sh"
		exit 0
	fi
	if ! getent passwd "$current_user" >/dev/null 2>&1; then
		echo ""
		echo "Appliance promotion removed the bootstrap account backing this terminal."
		echo "Open a new terminal as ${target_user:-the configured primary user}, then rerun: setup-wizard.sh"
		exit 0
	fi

	refresh_group_session_if_needed "$PI_DIR"
}
