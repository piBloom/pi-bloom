#!/usr/bin/env bash
# setup-wizard.sh — First-boot setup wizard for NixPI.
# Runs on first login before Pi starts. Uses read -p prompts.
# Each completed step writes a checkpoint to ~/.nixpi/wizard-state/.
# If interrupted (Ctrl+C), resumes from the last incomplete step on next login.
set -euo pipefail

# Logging setup - save wizard output for future reference
WIZARD_LOG="$HOME/.nixpi/wizard.log"
mkdir -p "$(dirname "$WIZARD_LOG")"
exec > >(tee -a "$WIZARD_LOG") 2>&1

echo "=== NixPI Wizard Started: $(date) ==="

WIZARD_STATE="$HOME/.nixpi/wizard-state"
SETUP_COMPLETE="$HOME/.nixpi/.setup-complete"
NIXPI_DIR="${NIXPI_DIR:-$HOME/nixpi}"
NIXPI_CONFIG="${NIXPI_CONFIG_DIR:-${NIXPI_STATE_DIR:-$HOME/.config/nixpi}/services}"
PI_DIR="${NIXPI_PI_DIR:-$HOME/.pi}"
MATRIX_HOMESERVER="http://localhost:6167"
MATRIX_STATE_DIR="$WIZARD_STATE/matrix-state"
LEGACY_SETUP_STATE="$HOME/.nixpi/setup-state.json"
BOOTSTRAP_STATE_DIR="$HOME/.nixpi/bootstrap"
BOOTSTRAP_UPGRADE_STATUS_FILE="${BOOTSTRAP_STATE_DIR}/full-appliance-upgrade.status"
BOOTSTRAP_UPGRADE_LOG_FILE="${BOOTSTRAP_STATE_DIR}/full-appliance-upgrade.log"
NIXPI_BOOTSTRAP_REPO="${NIXPI_BOOTSTRAP_REPO:-https://github.com/alexradunet/nixpi.git}"

# --- Prefill (for VM/dev use) ---
# Create ~/.nixpi/prefill.env on your host to skip manual prompts.
# When running in a VM via `just vm`, this file is shared into the VM automatically.
# Supported vars: PREFILL_NETBIRD_KEY, PREFILL_NAME, PREFILL_EMAIL,
#                 PREFILL_USERNAME, PREFILL_MATRIX_PASSWORD,
#                 PREFILL_PRIMARY_PASSWORD
PREFILL_FILE="$HOME/.nixpi/prefill.env"
# Fall back to host-shared mount (9p virtfs, available when running via `just vm`)
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

# Load shared function library.
SETUP_LIB="$(dirname "$0")/setup-lib.sh"
if [[ ! -f "$SETUP_LIB" ]]; then
	SETUP_LIB="/run/current-system/sw/bin/setup-lib.sh"
fi
# shellcheck source=setup-lib.sh
source "$SETUP_LIB"

# --- Checkpoint helpers ---

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

has_internet_connection() {
	ping -c1 -W5 1.1.1.1 &>/dev/null
}

has_gui_session() {
	[[ -n "${DISPLAY:-}" ]] && return 0
	systemctl is-active --quiet display-manager.service 2>/dev/null || return 1
	[[ -f "$HOME/.Xauthority" ]] || return 1
	return 0
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
	if [[ -d "$NIXPI_DIR/.git" ]]; then
		echo "Using existing checkout at ${NIXPI_DIR}."
		return 0
	fi

	if [[ -e "$NIXPI_DIR" ]] && [[ -n "$(ls -A "$NIXPI_DIR" 2>/dev/null || true)" ]]; then
		echo "Refusing to overwrite existing non-git directory: ${NIXPI_DIR}" >&2
		return 1
	fi

	mkdir -p "$(dirname "$NIXPI_DIR")"
	rm -rf "$NIXPI_DIR"
	nix --extra-experimental-features 'nix-command flakes' run nixpkgs#git -- clone "$NIXPI_BOOTSTRAP_REPO" "$NIXPI_DIR"
}

promote_full_appliance() {
	local hostname="$1"
	local primary_user="$2"

	install -d -m 0755 "$BOOTSTRAP_STATE_DIR"
	: > "$BOOTSTRAP_UPGRADE_LOG_FILE"

	write_appliance_status "Cloning the NixPI checkout..."
	if ! clone_nixpi_checkout 2>&1 | tee -a "$BOOTSTRAP_UPGRADE_LOG_FILE"; then
		write_appliance_status "Failed to prepare the NixPI checkout."
		return 1
	fi

	write_appliance_status "Writing the local /etc/nixos system flake..."
	if ! root_command nixpi-bootstrap-install-host-flake "$NIXPI_DIR" "$hostname" "$primary_user" 2>&1 | tee -a "$BOOTSTRAP_UPGRADE_LOG_FILE"; then
		write_appliance_status "Failed to write the local /etc/nixos flake."
		return 1
	fi

	write_appliance_status "Building and activating the full NixPI appliance..."
	if ! root_command nixpi-bootstrap-nixos-rebuild-switch "$hostname" 2>&1 | tee -a "$BOOTSTRAP_UPGRADE_LOG_FILE"; then
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

	if ! has_internet_connection; then
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
	echo "A local checkout will be cloned into ~/nixpi and activated through /etc/nixos."

	local current_hostname current_user
	current_hostname=$(hostnamectl --static 2>/dev/null || hostname -s)
	current_user=$(whoami)

	if ! promote_full_appliance "$current_hostname" "$current_user"; then
		echo "Appliance promotion failed. Review ${BOOTSTRAP_UPGRADE_LOG_FILE}." >&2
		print_recent_appliance_log >&2
		return 1
	fi

	echo "Standard NixPI appliance is ready."
	mark_done appliance
	refresh_group_session_if_needed "$PI_DIR"
}

prepare_local_state() {
	mkdir -p "$WIZARD_STATE" "$NIXPI_DIR"
	rm -f "$LEGACY_SETUP_STATE"
	if [[ ! -f "$PI_DIR/settings.json" && -f /usr/local/share/nixpi/.pi/settings.json ]]; then
		mkdir -p "$PI_DIR"
		cp /usr/local/share/nixpi/.pi/settings.json "$PI_DIR/settings.json"
		chmod 600 "$PI_DIR/settings.json" 2>/dev/null || true
	fi
}


write_pi_settings_defaults() {
	local provider="$1" model="$2"
	local settings_path="$PI_DIR/settings.json"
	mkdir -p "$(dirname "$settings_path")"

	if command -v jq >/dev/null 2>&1 && [[ -f "$settings_path" ]]; then
		jq \
			--arg package "/usr/local/share/nixpi" \
			--arg provider "$provider" \
			--arg model "$model" \
			'.packages = ((.packages // []) + [$package] | unique)
			 | .defaultProvider = $provider
			 | .defaultModel = $model
			 | .defaultThinkingLevel = (.defaultThinkingLevel // "medium")' \
			"$settings_path" > "${settings_path}.tmp"
		mv "${settings_path}.tmp" "$settings_path"
	else
		cat > "$settings_path" <<-SETTINGS
		{
		  "packages": [
		    "/usr/local/share/nixpi"
		  ],
		  "defaultProvider": "${provider}",
		  "defaultModel": "${model}",
		  "defaultThinkingLevel": "medium"
		}
		SETTINGS
	fi

	chmod 600 "$settings_path"
}

pi_ai_ready() {
	[[ -f "$PI_DIR/auth.json" ]] || return 1
	[[ -f "$PI_DIR/settings.json" ]] || return 1
	grep -q '"defaultProvider"[[:space:]]*:' "$PI_DIR/settings.json" || return 1
	grep -q '"defaultModel"[[:space:]]*:' "$PI_DIR/settings.json" || return 1
}

print_service_access_summary() {
	local _installed_services="$1" mesh_ip="$2" mesh_fqdn="$3"
	local mesh_host="${mesh_fqdn:-$mesh_ip}"

	echo "  Service access:"
	if [[ -n "$mesh_host" ]]; then
		echo "    NixPI Home   - http://${mesh_host}"
	fi
	if [[ -n "$mesh_ip" && "$mesh_ip" != "$mesh_host" ]]; then
		echo "    NixPI Home   - http://${mesh_ip}"
	fi
	echo "    Share this   - send other NetBird peers the NixPI Home URL"
	if [[ -n "$mesh_host" ]]; then
		echo "    Element Web  - http://${mesh_host}:8081"
	fi
	if [[ -n "$mesh_ip" && "$mesh_ip" != "$mesh_host" ]]; then
		echo "    Element Web  - http://${mesh_ip}:8081"
	fi
	echo "    Elmenet Web   - preconfigured for this NixPI server"
	if [[ -n "$mesh_host" ]]; then
		echo "    Matrix       - http://${mesh_host}:6167"
	fi
	if [[ -n "$mesh_ip" && "$mesh_ip" != "$mesh_host" ]]; then
		echo "    Matrix       - http://${mesh_ip}:6167"
	fi
	echo "    Matrix       - http://localhost:6167 (local access on the box)"
}


# --- Step functions ---

step_welcome() {
	prepare_local_state
	echo ""
	echo "Welcome to NixPI."
	echo "Let's configure your device. This takes a few minutes."
	echo "Press Ctrl+C at any time to abort — you'll resume where you left off next login."
	echo ""

	# Set hostname (NixOS derives it from networking.hostName; this sets it at runtime)
	if [[ "$(hostnamectl hostname 2>/dev/null)" != "nixpi" ]]; then
		root_command hostnamectl set-hostname nixpi 2>/dev/null || true
	fi

	mark_done welcome
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
	
	# Check if user already has a password set
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
		# Always use sudo to bypass current password check on first boot.
		# Using sudo allows root to set the password directly.
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
		echo "Network connected."
		mark_done network
		return
	fi

	echo "No network connection detected."
	if [[ "$NONINTERACTIVE_SETUP" -eq 1 ]]; then
		echo "Skipping interactive network setup in noninteractive mode."
		mark_done network
		return
	fi
	echo ""
	echo "Options:"
	echo "  1) Launch WiFi setup (nmtui) - recommended"
	echo "  2) Skip (configure later)"
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
				if has_internet_connection; then
					echo "Connected."
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

step_netbird() {
	echo ""
	echo "--- NetBird Mesh Network ---"
	echo "NetBird creates a private mesh network so you can access this device from anywhere."
	echo ""

	# Ensure netbird daemon is running before attempting connection
	if ! systemctl is-active --quiet netbird.service; then
		echo "Starting NetBird daemon..."
		root_command nixpi-bootstrap-netbird-systemctl start netbird.service 2>/dev/null || true
	fi
	local wait_count=0
	while [[ ! -S /var/run/netbird/sock ]]; do
		wait_count=$((wait_count + 1))
		if [[ $wait_count -ge 20 ]]; then
			echo "ERROR: NetBird daemon did not start. Run 'sudo systemctl status netbird' to debug."
			return 1
		fi
		sleep 0.5
	done

	echo "Connection options:"
	echo "  1) Web login (OAuth) - requires a desktop/browser session"
	echo "  2) Setup key - for headless/automated setup"
	echo "  3) Skip - configure later"
	echo ""

	if [[ "$NONINTERACTIVE_SETUP" -eq 1 && -z "${PREFILL_NETBIRD_KEY:-}" ]]; then
		echo "Skipping NetBird setup in noninteractive mode."
		mark_done netbird
		return
	fi

	while true; do
		read -rp "Select option [1/2/3]: " nb_choice
		case "$nb_choice" in
			1|web|oauth|login)
				echo ""
				if has_gui_session; then
					echo "Starting NetBird web login..."
					echo "If no browser opens, visit the URL shown below."
				else
					echo "No local desktop session is active."
					echo "NetBird may print a login URL, but it cannot open a browser window here."
					echo "Use option 2 with a setup key, or retry once the Openbox desktop is running."
				fi
				if root_command nixpi-bootstrap-netbird-up 2>&1; then
					# Wait for connection to establish
					for _ in $(seq 1 30); do
						sleep 1
						local status
						status=$(netbird status 2>/dev/null || true)
						if echo "$status" | grep -q "Connected"; then
							local mesh_ip
							mesh_ip=$(echo "$status" | grep -oP 'NetBird IP:\s+\K[\d.]+' || true)
							if [[ -n "$mesh_ip" ]]; then
								echo ""
								echo "Connected! Mesh IP: ${mesh_ip}"
								mark_done_with netbird "$mesh_ip"
								return
							fi
						fi
					done
					echo ""
					echo "Connection is taking longer than expected."
					echo "Check status with: netbird status"
					return 1
				fi
				echo ""
				echo "NetBird connection failed. Try again or use a setup key."
				;;
			2|key|setup-key)
				echo ""
				echo "Get a setup key from: https://app.netbird.io/setup-keys"
				while true; do
					if [[ -n "${PREFILL_NETBIRD_KEY:-}" ]]; then
						setup_key="$PREFILL_NETBIRD_KEY"
						echo "Setup key: [prefilled]"
					else
						read -rp "Setup key: " setup_key
					fi
					if [[ -z "$setup_key" ]]; then
						echo "Setup key cannot be empty."
						continue
					fi

					echo "Connecting to NetBird..."
					if root_command nixpi-bootstrap-netbird-up --setup-key "$setup_key" 2>&1; then
						sleep 3
						local status
						status=$(netbird status 2>/dev/null || true)

						if echo "$status" | grep -q "Connected"; then
							local mesh_ip
							mesh_ip=$(echo "$status" | grep -oP 'NetBird IP:\s+\K[\d.]+' || true)
							if [[ -n "$mesh_ip" ]]; then
								echo ""
								echo "Connected! Mesh IP: ${mesh_ip}"
								mark_done_with netbird "$mesh_ip"
								return
							fi
						fi
					fi
					echo ""
					echo "NetBird connection failed. Check your setup key and try again."
				done
				;;
			3|skip)
				echo "Skipping NetBird setup. You can configure later with: sudo netbird up"
				mark_done netbird
				return
				;;
			*)
				echo "Invalid option. Please enter 1, 2, or 3."
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

step_ai() {
	echo ""
	echo "--- AI Provider ---"
	if ! has_runtime_stack; then
		echo "Pi runtime is not installed in this profile. Skipping AI setup."
		mark_done_with ai "skipped"
		return
	fi
	echo "No local AI provider is bundled with this image."
	echo "  Pi will prompt for login or model selection when you start it."
	mark_done_with ai "skipped"
}

step_services() {
	echo ""
	echo "--- Built-In Services ---"
	if ! has_service_stack; then
		echo "Built-in service stack is not installed in this profile. Skipping."
		mark_done_with services "skipped"
		return
	fi
	local mesh_ip mesh_fqdn
	mesh_ip=$(read_checkpoint_data netbird)
	mesh_fqdn=$(netbird_fqdn)

	echo "  Refreshing built-in service configs..."
	write_element_web_runtime_config
	write_service_home_runtime "$mesh_ip" "$mesh_fqdn"
	if install_home_infrastructure; then
		echo "  NixPI Home ready."
	else
		echo "  NixPI Home setup failed."
	fi
	root_command nixpi-bootstrap-service-systemctl restart nixpi-home.service || echo "  home restart failed."
	root_command nixpi-bootstrap-service-systemctl restart nixpi-element-web.service || echo "  element restart failed."
	write_service_home_runtime "$mesh_ip" "$mesh_fqdn"
	mark_done_with services "home element-web"
}

step_bootc_switch() {
	echo ""
	echo "--- Update Guidance ---"
	echo "NixPI now runs from the local checkout at ~/nixpi and a host-specific flake in /etc/nixos."
	echo ""
	echo "To refresh the local checkout later:"
	echo "  cd ~/nixpi"
	echo "  git pull --ff-only"
	echo ""
	echo "To apply local changes manually:"
	echo "  sudo nixos-rebuild switch --flake /etc/nixos#$(hostname -s)"
	echo ""
	echo "If you need to clone the checkout again manually:"
	echo "  nix --extra-experimental-features 'nix-command flakes' run nixpkgs#git -- clone ${NIXPI_BOOTSTRAP_REPO} ~/nixpi"
	echo "  cd ~/nixpi"
	echo "  sudo nixos-rebuild switch --rollback"
	echo ""
	mark_done bootc_switch
}

# --- Finalization ---

finalize() {
	if [[ -f /usr/local/share/nixpi/.pi/settings.json ]]; then
		mkdir -p "$PI_DIR" 2>/dev/null || true
		if [[ ! -f "$PI_DIR/settings.json" ]]; then
			cp /usr/local/share/nixpi/.pi/settings.json "$PI_DIR/settings.json" 2>/dev/null || true
			chmod 600 "$PI_DIR/settings.json" 2>/dev/null || true
		fi
	fi
	if command -v nixpi-bootstrap-remove-primary-password >/dev/null 2>&1; then
		root_command nixpi-bootstrap-remove-primary-password || echo "warning: failed to remove bootstrap primary password file" >&2
	fi
	if [[ "${NIXPI_KEEP_SSH_AFTER_SETUP:-0}" != "1" ]]; then
		root_command nixpi-bootstrap-sshd-systemctl stop sshd.service || echo "warning: failed to stop sshd.service" >&2
	fi
	if has_matrix_stack; then
		root_command nixpi-bootstrap-matrix-systemctl try-restart continuwuity.service || echo "warning: failed to restart continuwuity.service" >&2
	fi
	if has_systemd_unit nixpi-daemon.service; then
		if ! root_command nixpi-bootstrap-service-systemctl enable --now nixpi-daemon.service; then
			echo "warning: failed to enable nixpi-daemon.service during wizard finalization" >&2
		fi
	fi
	if has_systemd_unit display-manager.service; then
		root_command nixpi-bootstrap-service-systemctl start display-manager.service || echo "warning: failed to start display-manager.service" >&2
	fi
	touch "$SETUP_COMPLETE"

	local mesh_ip
	mesh_ip=$(read_checkpoint_data netbird)
	local mesh_fqdn
	mesh_fqdn=$(netbird_fqdn)
	local matrix_user
	matrix_user=$(read_checkpoint_data matrix)
	local services
	services=$(read_checkpoint_data services)
	local ai_provider
	ai_provider=$(read_checkpoint_data ai)

	# Security warning if NetBird is not connected
	local netbird_connected=false
	if command -v netbird >/dev/null 2>&1; then
		local nb_status
		nb_status=$(netbird status 2>/dev/null || true)
		if echo "$nb_status" | grep -q "Connected"; then
			netbird_connected=true
		fi
	fi

	echo ""
	echo "========================================="
	echo "  Setup complete!"
	echo ""

	if [[ "$netbird_connected" != true ]]; then
		echo "  ⚠️  SECURITY WARNING: NetBird is not connected!"
		echo ""
		echo "  Without NetBird, all services are exposed to the local network."
		echo "  This is a security risk. Connect to NetBird before exposing"
		echo "  this machine to any untrusted network."
		echo ""
		echo "  To connect: sudo netbird up --setup-key <your-key>"
		echo ""
	fi

	[[ -n "$mesh_ip" ]] && echo "  Mesh IP: ${mesh_ip} (access from any NetBird peer)"
	[[ -n "$mesh_fqdn" ]] && echo "  NetBird name: ${mesh_fqdn}"
	[[ -n "$matrix_user" ]] && echo "  Matrix user: @${matrix_user}:nixpi"
	if [[ "$services" != "skipped" ]]; then
		echo "  Built-in services: ${services:-home chat}"
		echo ""
		print_service_access_summary "$services" "$mesh_ip" "$mesh_fqdn"
		echo ""
	fi
	echo ""
	if has_command pi; then
		echo "  Starting Pi — your AI companion."
		echo ""
		if [[ "$ai_provider" == "skipped" ]]; then
			echo "  To get started in Pi:"
			echo "    /login  — authenticate with your AI provider"
			echo "    /model  — select your preferred model"
		else
			echo "  AI provider: ${ai_provider}"
			echo "  Use /model in Pi to select a model."
		fi
	else
		echo "  Next: restore ~/nixpi and rebuild via /etc/nixos if you want the full NixPI profile again."
	fi
	echo "========================================="
	echo ""
}

# --- Main ---

main() {
	if [[ -f "$SETUP_COMPLETE" ]]; then
		return 0
	fi

	if [[ -d "$WIZARD_STATE" ]] && ls "$WIZARD_STATE"/* &>/dev/null; then
		echo "Resuming setup..."
	fi

	step_done welcome  || step_welcome
	step_done network  || step_network
	step_done password || step_password
	step_done appliance || step_appliance
	refresh_group_session_if_needed "$PI_DIR"
	step_done netbird  || step_netbird
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

main
