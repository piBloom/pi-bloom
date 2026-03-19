#!/usr/bin/env bash
# bloom-wizard.sh — First-boot setup wizard for Bloom OS.
# Runs on first login before Pi starts. Uses read -p prompts.
# Each completed step writes a checkpoint to ~/.bloom/wizard-state/.
# If interrupted (Ctrl+C), resumes from the last incomplete step on next login.
set -euo pipefail

# Logging setup - save wizard output for future reference
WIZARD_LOG="$HOME/.bloom/wizard.log"
mkdir -p "$(dirname "$WIZARD_LOG")"
exec > >(tee -a "$WIZARD_LOG") 2>&1

echo "=== Bloom Wizard Started: $(date) ==="

WIZARD_STATE="$HOME/.bloom/wizard-state"
SETUP_COMPLETE="$HOME/.bloom/.setup-complete"
BLOOM_DIR="${BLOOM_DIR:-$HOME/Bloom}"
SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
BLOOM_CONFIG="$HOME/.config/bloom"
PI_DIR="$HOME/.pi"
MATRIX_HOMESERVER="http://localhost:6167"
MATRIX_STATE_DIR="$WIZARD_STATE/matrix-state"

# --- Prefill (for VM/dev use) ---
# Create ~/.bloom/prefill.env on your host to skip manual prompts.
# When running in a VM via `just vm`, this file is shared into the VM automatically.
# Supported vars: PREFILL_NETBIRD_KEY, PREFILL_NAME, PREFILL_EMAIL,
#                 PREFILL_USERNAME, PREFILL_MATRIX_PASSWORD
PREFILL_FILE="$HOME/.bloom/prefill.env"
# Fall back to host-shared mount (9p virtfs, available when running via `just vm`)
if [[ ! -f "$PREFILL_FILE" && -f "/mnt/host-bloom/prefill.env" ]]; then
	PREFILL_FILE="/mnt/host-bloom/prefill.env"
fi
if [[ -f "$PREFILL_FILE" ]]; then
	# shellcheck source=/dev/null
	source "$PREFILL_FILE"
fi

# Load shared function library.
BLOOM_LIB="$(dirname "$0")/bloom-lib.sh"
if [[ ! -f "$BLOOM_LIB" ]]; then
	BLOOM_LIB="/run/current-system/sw/bin/bloom-lib.sh"
fi
# shellcheck source=bloom-lib.sh
source "$BLOOM_LIB"

# --- Checkpoint helpers ---

step_done() { [[ -f "$WIZARD_STATE/$1" ]]; }


write_pi_settings_defaults() {
	local provider="$1" model="$2"
	local settings_path="$PI_DIR/agent/settings.json"
	mkdir -p "$(dirname "$settings_path")"

	if command -v jq >/dev/null 2>&1 && [[ -f "$settings_path" ]]; then
		jq \
			--arg package "/usr/local/share/bloom" \
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
		    "/usr/local/share/bloom"
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
	[[ -f "$PI_DIR/agent/auth.json" ]] || return 1
	[[ -f "$PI_DIR/agent/settings.json" ]] || return 1
	grep -q '"defaultProvider"[[:space:]]*:' "$PI_DIR/agent/settings.json" || return 1
	grep -q '"defaultModel"[[:space:]]*:' "$PI_DIR/agent/settings.json" || return 1
}

print_service_access_summary() {
	local _installed_services="$1" mesh_ip="$2" mesh_fqdn="$3"
	local mesh_host="${mesh_fqdn:-$mesh_ip}"

	echo "  Service access:"
	if [[ -n "$mesh_host" ]]; then
		echo "    Bloom Home   - http://${mesh_host}:8080"
	fi
	if [[ -n "$mesh_ip" && "$mesh_ip" != "$mesh_host" ]]; then
		echo "    Bloom Home   - http://${mesh_ip}:8080"
	fi
	echo "    Share this   - send other NetBird peers the Bloom Home URL"
	if [[ -n "$mesh_host" ]]; then
		echo "    Bloom Web Chat - http://${mesh_host}:8081"
	fi
	if [[ -n "$mesh_ip" && "$mesh_ip" != "$mesh_host" ]]; then
		echo "    Bloom Web Chat - http://${mesh_ip}:8081"
		echo "    dufs/WebDAV  - http://${mesh_ip}:5000"
		echo "    code-server  - http://${mesh_ip}:8443"
	fi
	echo "    FluffyChat   - preconfigured for this Bloom server"
	if [[ -n "$mesh_host" ]]; then
		echo "    dufs/WebDAV  - http://${mesh_host}:5000"
		echo "    code-server  - http://${mesh_host}:8443"
	fi
	echo "    dufs path    - ~/Public/Bloom"

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
	echo ""
	echo "Welcome to Bloom OS."
	echo "Let's configure your device. This takes a few minutes."
	echo "Press Ctrl+C at any time to abort — you'll resume where you left off next login."
	echo ""

	# Set hostname (NixOS derives it from networking.hostName; this sets it at runtime)
	if [[ "$(hostnamectl hostname 2>/dev/null)" != "bloom" ]]; then
		sudo hostnamectl set-hostname bloom 2>/dev/null || true
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
	echo "Welcome! Let's set up a password for your account."
	echo ""
	if [[ -n "${PREFILL_PI_PASSWORD:-}" ]]; then
		echo "$(whoami):${PREFILL_PI_PASSWORD}" | sudo chpasswd
		echo "Password set."
	else
		# Always use sudo to bypass current password check on first boot.
		# The pi user has no initial password, but 'passwd' alone may still
		# prompt for one depending on PAM configuration. Using sudo allows
		# root to set the password directly.
		while ! sudo passwd "$(whoami)"; do
			echo ""
			echo "Password setup failed. Please try again."
		done
	fi
	mark_done password
}

step_network() {
	echo ""
	echo "--- Network ---"
	if ping -c1 -W5 1.1.1.1 &>/dev/null; then
		echo "Network connected."
		mark_done network
		return
	fi

	echo "No network connection detected."
	echo ""
	echo "Options:"
	echo "  1) Launch WiFi setup UI (nmtui) - recommended"
	echo "  2) Enter WiFi details manually"
	echo "  3) Skip (configure later)"
	echo ""

	while true; do
		read -rp "Select option [1/2/3]: " choice
		case "$choice" in
			1|nmtui|ui)
				echo "Launching WiFi setup UI..."
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
				if ping -c1 -W5 1.1.1.1 &>/dev/null; then
					echo "Connected."
					mark_done network
					return
				fi
				echo "Still not connected. Try again or check your credentials."
				;;
			2|manual)
				read -rp "WiFi SSID: " ssid
				read -rsp "WiFi password: " psk
				echo ""
				echo "Connecting to ${ssid}..."
				if nmcli device wifi connect "$ssid" password "$psk" 2>/dev/null; then
					if ping -c1 -W5 1.1.1.1 &>/dev/null; then
						echo "Connected."
						mark_done network
						return
					fi
				fi
				echo "Connection failed. Try again."
				;;
			3|skip)
				echo "Skipping network setup. You can configure WiFi later with: nmtui"
				mark_done network
				return
				;;
			*)
				echo "Invalid option. Please enter 1, 2, or 3."
				;;
		esac
	done
}

step_netbird() {
	echo ""
	echo "--- NetBird Mesh Network ---"
	echo "NetBird creates a private mesh network so you can access this device from anywhere."
	echo "You'll need a setup key from your NetBird dashboard (app.netbird.io → Setup Keys)."
	echo ""

	# Ensure netbird daemon is running before attempting connection
	if ! systemctl is-active --quiet netbird.service; then
		echo "Starting NetBird daemon..."
		sudo systemctl start netbird.service 2>/dev/null || true
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
		if sudo netbird up --setup-key "$setup_key" 2>&1; then
			# Wait a moment for connection to establish
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
}

step_git() {
	echo ""
	echo "--- Git Identity ---"
	if [[ -n "${PREFILL_NAME:-}" ]]; then
		git_name="$PREFILL_NAME"
		echo "Your name: [prefilled]"
	else
		read -rp "Your name: " git_name
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
	echo "Configuring Pi to use local AI (llama-server on port 11435)..."
	write_pi_settings_defaults "localai" "omnicoder-9b-q4_k_m"
	echo "  Local AI configured. Pi will use OmniCoder 9B by default."
	mark_done_with ai "localai"
}

step_services() {
	echo ""
	echo "--- Built-In Services ---"
	local mesh_ip mesh_fqdn
	mesh_ip=$(read_checkpoint_data netbird)
	mesh_fqdn=$(netbird_fqdn)

	echo "  Refreshing built-in service configs..."
	write_fluffychat_runtime_config
	write_service_home_runtime "$mesh_ip" "$mesh_fqdn"
	if install_home_infrastructure; then
		echo "  Bloom Home ready."
	else
		echo "  Bloom Home setup failed."
	fi
	systemctl --user restart bloom-fluffychat.service || echo "  FluffyChat restart failed."
	systemctl --user restart bloom-dufs.service || echo "  dufs restart failed."
	systemctl --user restart bloom-code-server.service || echo "  code-server restart failed."
	write_service_home_runtime "$mesh_ip" "$mesh_fqdn"
	mark_done_with services "fluffychat dufs code-server"
}

step_bootc_switch() {
	echo ""
	echo "--- System Updates ---"
	echo "Bloom OS uses NixOS with automatic OTA updates."
	echo "The bloom-update timer checks for updates every 6 hours."
	echo ""
	echo "To update manually at any time: sudo nixos-rebuild switch --flake github:alexradunet/piBloom#bloom-x86_64"
	echo "To roll back:                   sudo nixos-rebuild switch --rollback"
	echo ""
	mark_done bootc_switch
}

# --- Finalization ---

finalize() {
	touch "$SETUP_COMPLETE"
	loginctl enable-linger "$USER"
	if ! systemctl --user enable --now pi-daemon.service; then
		echo "warning: failed to enable pi-daemon.service during wizard finalization" >&2
	fi

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
	[[ -n "$matrix_user" ]] && echo "  Matrix user: @${matrix_user}:bloom"
	echo "  Built-in services: ${services:-fluffychat dufs code-server}"
	echo ""
	print_service_access_summary "$services" "$mesh_ip" "$mesh_fqdn"
	echo ""
	if [[ "$ai_provider" == "localai" ]]; then
		echo "  Waiting for local AI to be ready..."
		for i in $(seq 1 180); do
			if curl -sf http://localhost:11435/health > /dev/null 2>&1; then
				echo "  Local AI ready."
				break
			fi
			if [[ $i -eq 180 ]]; then
				echo "  Local AI is taking longer than expected — it will finish loading soon."
			fi
			sleep 1
		done
	fi
	echo ""
	echo "  Starting Pi — your AI companion."
	if [[ "$ai_provider" == "skipped" ]]; then
		echo ""
		echo "  To get started in Pi:"
		echo "    /login  — authenticate with your AI provider"
		echo "    /model  — select your preferred model"
	else
		echo ""
		echo "  AI provider: ${ai_provider}"
		echo "  Use /model in Pi to select a model."
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
	step_done password || step_password
	step_done network  || step_network
	step_done netbird  || step_netbird
	step_done matrix   || step_matrix
	step_done git      || step_git
	step_done ai       || step_ai
	step_done services || step_services
	step_done bootc_switch || step_bootc_switch

	finalize
}

main
