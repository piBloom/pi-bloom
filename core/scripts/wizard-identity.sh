#!/usr/bin/env bash
# Identity and local bootstrap phase helpers for setup-wizard.sh.

prepare_local_state() {
	mkdir -p "$WIZARD_STATE"
	rm -f "$LEGACY_SETUP_STATE"
	if [[ ! -f "$PI_DIR/settings.json" && -f /usr/local/share/nixpi/.pi/settings.json ]]; then
		mkdir -p "$PI_DIR"
		cp /usr/local/share/nixpi/.pi/settings.json "$PI_DIR/settings.json"
		chmod 600 "$PI_DIR/settings.json" 2>/dev/null || true
	fi
}

step_welcome() {
	prepare_local_state
	echo ""
	echo "Welcome to NixPI."
	echo "Let's configure your device. This takes a few minutes."
	echo "Press Ctrl+C at any time to abort — you'll resume where you left off next login."
	echo ""

	mark_done welcome
}

step_locale() {
	echo ""
	echo "--- Locale & Timezone ---"
	echo "Common timezones: UTC, Europe/Paris, Europe/London, America/New_York, America/Los_Angeles, Asia/Tokyo"
	echo "Common keyboard layouts: us, uk, fr, de, es"
	echo ""

	local tz kb
	tz="${NIXPI_TIMEZONE:-}"
	kb="${NIXPI_KEYBOARD:-}"

	if [[ -z "$tz" ]]; then
		if [[ "$NONINTERACTIVE_SETUP" -eq 1 ]]; then
			tz="UTC"
			echo "Timezone: ${tz} [default for noninteractive setup]"
		else
			read -rp "Timezone [UTC]: " tz
			tz="${tz:-UTC}"
		fi
	else
		echo "Timezone (prefill): $tz"
	fi

	if [[ -z "$kb" ]]; then
		if [[ "$NONINTERACTIVE_SETUP" -eq 1 ]]; then
			kb="us"
			echo "Keyboard layout: ${kb} [default for noninteractive setup]"
		else
			read -rp "Keyboard layout [us]: " kb
			kb="${kb:-us}"
		fi
	else
		echo "Keyboard layout (prefill): $kb"
	fi

	local hostname primary_user
	hostname="$(configured_hostname)" || {
		echo "ERROR: Could not determine the configured hostname from /etc/nixos/nixpi-host.nix or /etc/nixos/nixpi-install.nix." >&2
		return 1
	}
	primary_user="$(configured_primary_user)" || {
		echo "ERROR: Could not determine the configured primary user from /etc/nixos/nixpi-host.nix or /etc/nixos/nixpi-install.nix." >&2
		return 1
	}

	root_command nixpi-bootstrap-write-host-nix "$hostname" "$primary_user" "$tz" "$kb"

	echo "Applying locale settings (this may take a minute)..."
	root_command nixpi-bootstrap-nixos-rebuild-switch || {
		echo "warning: nixos-rebuild failed; locale settings saved but not applied yet." >&2
	}

	mark_done locale
}

step_password() {
	echo "--- Password Setup ---"
	echo ""
	if [[ -n "${PREFILL_PASSWORD_DONE:-}" ]]; then
		echo "Password was already set during installation."
		mark_done password
		return
	fi

	local bootstrap_primary_password
	bootstrap_primary_password=$(read_bootstrap_primary_password)
	if [[ -n "$bootstrap_primary_password" ]]; then
		echo "Password was already set during installation."
		mark_done password
		return
	fi

	if [[ "$(passwd -S "$(whoami)" 2>/dev/null | awk '{print $2}')" == "P" ]]; then
		echo "You already have a password set for this account."
		echo "Keeping the existing login password."
		mark_done password
		return
	else
		echo "Welcome! Let's set up a password for your account."
		echo ""
		if [[ "$NONINTERACTIVE_SETUP" -eq 1 ]]; then
			echo "Skipping password prompt for noninteractive setup."
			mark_done password
			return
		fi
	fi

	if [[ -n "${PREFILL_PRIMARY_PASSWORD:-}" ]]; then
		echo "$(whoami):${PREFILL_PRIMARY_PASSWORD}" | root_command nixpi-bootstrap-chpasswd
		echo "Password set."
	else
		while ! root_command nixpi-bootstrap-passwd; do
			echo ""
			echo "Password setup failed. Please try again."
		done
	fi
	mark_done password
}

step_network() {
	echo ""
	echo "--- Network ---"
	if has_internet_connection; then
		if [[ "$NONINTERACTIVE_SETUP" -eq 1 ]] || ! has_wifi_device || wifi_is_active_connection; then
			echo "Network connected."
			apply_wifi_preference
			mark_done network
			return
		fi

		echo "Internet is already up, but WiFi is not the active connection."
		echo "NixPI prefers WiFi on mini-PC installs and falls back to Ethernet only when WiFi is unavailable."
		echo ""
		echo "Options:"
		echo "  1) Launch WiFi setup (recommended)"
		echo "  2) Continue with Ethernet fallback for now"
		echo ""

		while true; do
			read -rp "Select option [1/2]: " choice
			case "$choice" in
				1|nmtui|ui)
					echo "Launching WiFi setup..."
					if command -v nmtui >/dev/null 2>&1; then
						nmtui
					else
						echo "nmtui not available, using nmcli..."
						nmcli device wifi list
						read -rp "WiFi SSID: " ssid
						read -rsp "WiFi password: " psk
						echo ""
						nmcli device wifi connect "$ssid" password "$psk" 2>/dev/null || true
					fi
					apply_wifi_preference
					if has_internet_connection; then
						if wifi_is_active_connection; then
							echo "Connected with WiFi."
						else
							echo "Internet remains up through Ethernet fallback."
						fi
						mark_done network
						return
					fi
					echo "Still not connected. Try again or continue with Ethernet fallback."
					;;
				2|skip)
					echo "Continuing with Ethernet fallback."
					apply_wifi_preference
					mark_done network
					return
					;;
				*)
					echo "Invalid option. Please enter 1 or 2."
					;;
			esac
		done
	fi

	echo "No network connection detected."
	if [[ "$NONINTERACTIVE_SETUP" -eq 1 ]]; then
		echo "Skipping interactive network setup in noninteractive mode."
		mark_done network
		return
	fi
	if ! has_wifi_device; then
		log "no WiFi hardware detected, skipping WiFi preference"
		echo ""
		echo "Options:"
		echo "  1) Skip and configure network later (connect Ethernet before continuing)"
		echo ""
	else
		echo ""
		echo "Options:"
		echo "  1) Launch WiFi setup (recommended)"
		echo "  2) Skip and configure network later"
		echo ""
	fi

	while true; do
		read -rp "Select option [1/2]: " choice
		case "$choice" in
			1|nmtui|ui)
				echo "Launching WiFi setup..."
				if command -v nmtui >/dev/null 2>&1; then
					nmtui
				else
					echo "nmtui not available, using nmcli..."
					nmcli device wifi list
					read -rp "WiFi SSID: " ssid
					read -rsp "WiFi password: " psk
					echo ""
					nmcli device wifi connect "$ssid" password "$psk" 2>/dev/null || true
				fi
				apply_wifi_preference
				if has_internet_connection; then
					if wifi_is_active_connection; then
						echo "Connected with WiFi."
					else
						echo "Connected."
					fi
					mark_done network
					return
				fi
				echo "Still not connected. Try again or check your credentials."
				;;
			2|skip)
				echo "Skipping network setup. You can configure WiFi later with: nmtui"
				return
				;;
			*)
				echo "Invalid option. Please enter 1 or 2."
				;;
		esac
	done
}

step_git() {
	echo ""
	echo "--- Git Identity ---"
	if ! has_git; then
		echo "Git is not installed in this profile. Skipping identity setup."
		mark_done_with git "skipped"
		return
	fi
	if [[ "$NONINTERACTIVE_SETUP" -eq 1 && -z "${PREFILL_NAME:-}" && -z "${PREFILL_EMAIL:-}" ]]; then
		echo "Skipping git identity prompts in noninteractive mode."
		mark_done git
		return
	fi
	if [[ -n "${PREFILL_NAME:-}" ]]; then
		git_name="$PREFILL_NAME"
		echo "Your name: [prefilled]"
	else
		git_name="$(whoami)"
		echo "Your name: ${git_name} [from login username]"
	fi
	if [[ -n "${PREFILL_EMAIL:-}" ]]; then
		git_email="$PREFILL_EMAIL"
		echo "Email: [prefilled]"
	else
		read -rp "Email: " git_email
	fi

	[[ -n "$git_name" ]] && git config --global user.name "$git_name"
	[[ -n "$git_email" ]] && git config --global user.email "$git_email"

	echo "Git identity configured."
	mark_done git
}
