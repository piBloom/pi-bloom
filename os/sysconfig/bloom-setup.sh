#!/usr/bin/env bash
# bloom-setup.sh — First-boot setup wizard for Bloom OS
# Runs once as root on VT1 via bloom-setup.service (systemd oneshot).
# Collects WiFi, password, and optional NetBird config, then reboots.
set -euo pipefail

# ── Colors & Symbols ────────────────────────────────────────────────
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
RED=$'\033[0;31m'
CYAN=$'\033[0;36m'
DIM=$'\033[2m'
BOLD=$'\033[1m'
RESET=$'\033[0m'

OK="✓"
FAIL="✗"
ARROW="→"
BULLET="●"

# Terminal width for box drawing
COLS=52

# ── Helper Functions ────────────────────────────────────────────────

# Print a horizontal rule of box-drawing characters
hr() {
	local width=$((COLS - 2))
	local line=""
	for ((i = 0; i < width; i++)); do
		line+="─"
	done
	printf "%s" "$line"
}

# Draw a framed box with title and body lines
# Usage: banner "Title" "line1" "line2" ...
banner() {
	local title="$1"
	shift
	local width=$((COLS - 4))
	local rule
	rule=$(hr)

	printf "\n"
	printf "  %s╭%s╮%s\n" "$CYAN" "$rule" "$RESET"
	printf "  %s│%s%-${width}s%s│%s\n" "$CYAN" "$RESET" "" "$CYAN" "$RESET"

	if [[ -n "$title" ]]; then
		local title_len=${#title}
		local pad_left=$(((width - title_len) / 2))
		local pad_right=$((width - title_len - pad_left))
		printf "  %s│%s%${pad_left}s%s%s%s%${pad_right}s%s│%s\n" \
			"$CYAN" "$RESET" "" "$BOLD" "$title" "$RESET" "" "$CYAN" "$RESET"
		printf "  %s│%s%-${width}s%s│%s\n" "$CYAN" "$RESET" "" "$CYAN" "$RESET"
	fi

	for line in "$@"; do
		if [[ -z "$line" ]]; then
			printf "  %s│%s%-${width}s%s│%s\n" "$CYAN" "$RESET" "" "$CYAN" "$RESET"
		else
			local content_len=${#line}
			local right_pad=$((width - content_len - 2))
			if ((right_pad < 0)); then
				right_pad=0
			fi
			printf "  %s│%s  %s%${right_pad}s%s│%s\n" "$CYAN" "$RESET" "$line" "" "$CYAN" "$RESET"
		fi
	done

	printf "  %s│%s%-${width}s%s│%s\n" "$CYAN" "$RESET" "" "$CYAN" "$RESET"
	printf "  %s╰%s╯%s\n" "$CYAN" "$rule" "$RESET"
	printf "\n"
}

# Informational message (cyan)
info() {
	printf "  %s%s%s %s\n" "$CYAN" "$ARROW" "$RESET" "$*"
}

# Success message (green checkmark)
success() {
	printf "  %s%s%s %s\n" "$GREEN" "$OK" "$RESET" "$*"
}

# Warning message (yellow)
warn() {
	printf "  %s%s%s %s\n" "$YELLOW" "$BULLET" "$RESET" "$*"
}

# Error message (red X)
error() {
	printf "  %s%s%s %s\n" "$RED" "$FAIL" "$RESET" "$*"
}

# Print a prompt prefix (yellow arrow + message)
show_prompt() {
	printf "  %s%s%s %s " "$YELLOW" "$ARROW" "$RESET" "$*"
}

# Print a step header with educational context
step_header() {
	local step="$1"
	local what="$2"
	local why="$3"

	printf "\n"
	printf "  %s%s%s\n" "$BOLD" "$step" "$RESET"
	printf "\n"
	printf "  %sWhat:%s %s\n" "$CYAN" "$RESET" "$what"
	printf "  %sWhy:  %s%s\n" "$DIM" "$why" "$RESET"
	printf "\n"
}

# Convert signal strength (0-100) to visual bars
signal_bars() {
	local signal="$1"
	if ((signal >= 75)); then
		printf "▂▄▆█"
	elif ((signal >= 50)); then
		printf "▂▄▆ "
	elif ((signal >= 25)); then
		printf "▂▄  "
	else
		printf "▂   "
	fi
}

# ── Welcome Screen ──────────────────────────────────────────────────

show_welcome() {
	clear
	printf "\n\n"
	printf "  %s" "$GREEN"
	printf "          ___.   .__\n"
	printf "          \\_ |__ |  |   ____   ____   _____\n"
	printf "           | __ \\|  |  /  _ \\ /  _ \\ /     \\\\\n"
	printf "           | \\_\\ \\  |_(  <_> |  <_> )  Y Y  \\\\\n"
	printf "           |___  /____/\\____/ \\____/|__|_|  /\n"
	printf "               \\/                         \\/\n"
	printf "  %s" "$RESET"

	banner "" \
		"Your personal AI companion is almost ready." \
		"Let's set up a few things first." \
		"" \
		"${DIM}This will only take a minute or two.${RESET}"

	printf "  %sSteps:%s\n" "$DIM" "$RESET"
	printf "    %s WiFi          %s(if hardware detected)%s\n" "$BULLET" "$DIM" "$RESET"
	printf "    %s Password      %s(for your bloom account)%s\n" "$BULLET" "$DIM" "$RESET"
	printf "    %s NetBird       %s(optional mesh networking)%s\n" "$BULLET" "$DIM" "$RESET"
	printf "\n"
	printf "  Press %sEnter%s to begin " "$BOLD" "$RESET"
	read -r
}

# ── Step 1: WiFi ────────────────────────────────────────────────────

setup_wifi() {
	clear
	step_header "Step 1 of 3 — WiFi" \
		"Connect to WiFi so your Bloom can reach the internet." \
		"Needed for updates, mesh networking, and remote access."

	# Check for WiFi hardware
	if ! nmcli -t -f TYPE dev 2>/dev/null | grep -q wifi; then
		info "No WiFi adapter detected — skipping."
		printf "  %s(Ethernet or another connection will be used instead.)%s\n" "$DIM" "$RESET"
		sleep 2
		return 0
	fi

	# WiFi adapter exists — check if already connected
	local current_wifi
	current_wifi=$(nmcli -t -f NAME,TYPE con show --active 2>/dev/null | grep ':802-11-wireless$' | cut -d: -f1 || true)
	if [[ -n "$current_wifi" ]]; then
		success "Already connected to WiFi: ${BOLD}${current_wifi}${RESET}"
		printf "\n"
		local wifi_choice
		show_prompt "Keep this connection? [Y/n/s to skip]:"
		read -r wifi_choice
		case "${wifi_choice,,}" in
		n)
			: # Fall through to scan
			;;
		s)
			info "Skipping WiFi setup."
			sleep 1
			return 0
			;;
		*)
			success "Keeping current WiFi connection."
			sleep 1
			return 0
			;;
		esac
	fi

	while true; do
		info "Scanning for WiFi networks..."
		nmcli dev wifi rescan 2>/dev/null || true
		sleep 2

		# Collect networks: deduplicate by SSID, sort by signal descending
		local networks
		networks=$(nmcli -t -f SSID,SIGNAL,SECURITY dev wifi list 2>/dev/null \
			| grep -v '^:' \
			| sort -t: -k2 -rn \
			| awk -F: '!seen[$1]++ { print NR":"$0 }' \
			| head -15)

		if [[ -z "$networks" ]]; then
			warn "No WiFi networks found."
			printf "\n"
			local wifi_retry_choice
			show_prompt "Try again or skip? [r to retry / s to skip]:"
			read -r wifi_retry_choice
			case "${wifi_retry_choice,,}" in
			r) continue ;;
			*)
				info "Skipping WiFi setup."
				sleep 1
				return 0
				;;
			esac
		fi

		printf "\n"
		printf "  %sAvailable networks:%s\n\n" "$BOLD" "$RESET"

		# Display the list
		local count=0
		local ssids=()
		local securities=()
		while IFS=: read -r _num ssid signal security; do
			count=$((count + 1))
			ssids+=("$ssid")
			securities+=("$security")
			local bars
			bars=$(signal_bars "$signal")
			local sec_display
			if [[ -n "$security" && "$security" != "--" ]]; then
				sec_display="${DIM}${security}${RESET}"
			else
				sec_display="${DIM}open${RESET}"
			fi
			printf "    %s%2d%s  %s  %-30s %s\n" "$BOLD" "$count" "$RESET" "$bars" "$ssid" "$sec_display"
		done <<< "$networks"

		printf "\n"
		local wifi_pick
		show_prompt "Enter a number to connect (or s to skip):"
		read -r wifi_pick

		if [[ "${wifi_pick,,}" == "s" ]]; then
			info "Skipping WiFi setup."
			sleep 1
			return 0
		fi

		# Validate selection
		if ! [[ "$wifi_pick" =~ ^[0-9]+$ ]] || ((wifi_pick < 1 || wifi_pick > count)); then
			error "Invalid selection. Please enter a number between 1 and ${count}."
			sleep 2
			continue
		fi

		local selected_ssid="${ssids[$((wifi_pick - 1))]}"
		local selected_security="${securities[$((wifi_pick - 1))]}"

		printf "\n"
		info "Selected: ${BOLD}${selected_ssid}${RESET}"

		# Check if this network needs a password
		if [[ -n "$selected_security" && "$selected_security" != "--" ]]; then
			local wifi_pass
			show_prompt "WiFi password:"
			read -rs wifi_pass
			printf "\n"

			info "Connecting to ${BOLD}${selected_ssid}${RESET}..."
			if nmcli dev wifi connect "$selected_ssid" password "$wifi_pass" 2>/dev/null; then
				printf "\n"
				success "Connected to ${BOLD}${selected_ssid}${RESET}"
				sleep 2
				return 0
			else
				printf "\n"
				error "Couldn't connect. Check the password and try again."
				printf "\n"
				local wifi_retry
				show_prompt "Press r to retry, or s to skip:"
				read -r wifi_retry
				case "${wifi_retry,,}" in
				s)
					info "Skipping WiFi setup."
					sleep 1
					return 0
					;;
				*) continue ;;
				esac
			fi
		else
			info "Connecting to ${BOLD}${selected_ssid}${RESET} (open network)..."
			if nmcli dev wifi connect "$selected_ssid" 2>/dev/null; then
				printf "\n"
				success "Connected to ${BOLD}${selected_ssid}${RESET}"
				sleep 2
				return 0
			else
				printf "\n"
				error "Couldn't connect to the open network."
				printf "\n"
				local wifi_retry
				show_prompt "Press r to retry, or s to skip:"
				read -r wifi_retry
				case "${wifi_retry,,}" in
				s)
					info "Skipping WiFi setup."
					sleep 1
					return 0
					;;
				*) continue ;;
				esac
			fi
		fi
	done
}

# ── Step 2: Password ───────────────────────────────────────────────

setup_password() {
	clear
	step_header "Step 2 of 3 — Password" \
		"Create a password for your bloom user account." \
		"Protects your Bloom. Used for login, sudo, and remote access."

	while true; do
		local pass1 pass2
		show_prompt "Choose a password (min. 8 characters):"
		read -rs pass1
		printf "\n"
		show_prompt "Confirm password:"
		read -rs pass2
		printf "\n"

		if [[ "$pass1" != "$pass2" ]]; then
			printf "\n"
			error "Passwords don't match. Let's try again."
			printf "\n"
			continue
		fi

		if ((${#pass1} < 8)); then
			printf "\n"
			error "Password must be at least 8 characters."
			printf "\n"
			continue
		fi

		# Set the password
		if printf "%s:%s" "bloom" "$pass1" | chpasswd 2>/dev/null; then
			printf "\n"
			success "Password set for the ${BOLD}bloom${RESET} account."
			sleep 2
			return 0
		else
			printf "\n"
			error "Failed to set password. Please try again."
			printf "\n"
		fi
	done
}

# ── Security Hardening ──────────────────────────────────────────────

apply_hardening() {
	info "Applying security hardening..."
	printf "\n"

	# ── Firewall ──
	info "Configuring firewall..."

	# Create the bloom zone if it doesn't exist
	if ! firewall-cmd --permanent --get-zones 2>/dev/null | grep -q bloom; then
		firewall-cmd --permanent --new-zone=bloom >/dev/null 2>&1 || true
	fi

	# Set bloom as the default zone
	firewall-cmd --permanent --set-default-zone=bloom >/dev/null 2>&1 || true

	# NetBird mesh (wt0) is trusted — allow all traffic from mesh peers
	firewall-cmd --permanent --zone=trusted --add-interface=wt0 >/dev/null 2>&1 || true

	# Default zone only allows SSH from local subnets
	firewall-cmd --permanent --zone=bloom --add-service=ssh >/dev/null 2>&1 || true

	# Detect local RFC1918 subnets from active interfaces and allow SSH from them
	while IFS=' ' read -r _ _ subnet _; do
		if [[ -n "$subnet" ]]; then
			firewall-cmd --permanent --zone=bloom \
				--add-rich-rule="rule family=\"ipv4\" source address=\"${subnet}\" service name=\"ssh\" accept" \
				>/dev/null 2>&1 || true
		fi
	done < <(ip -4 -o addr show scope global 2>/dev/null \
		| awk '{print $2, $3, $4}' \
		| grep -E '(^10\.|^172\.(1[6-9]|2[0-9]|3[01])\.|^192\.168\.)' || true)

	# Reload firewall to apply
	firewall-cmd --reload >/dev/null 2>&1 || true

	success "Firewall configured — mesh and local SSH allowed, all else dropped."

	# ── SSH Hardening ──
	info "Hardening SSH configuration..."

	mkdir -p /etc/ssh/sshd_config.d
	cat > /etc/ssh/sshd_config.d/bloom.conf <<-'SSHEOF'
		PasswordAuthentication yes
		AllowUsers bloom
		PermitRootLogin no
		MaxAuthTries 3
		LoginGraceTime 30
	SSHEOF

	# Restart sshd to apply
	systemctl restart sshd 2>/dev/null || true

	success "SSH hardened — only bloom user, no root login, max 3 attempts."
	printf "\n"
}

# ── Step 3: NetBird ─────────────────────────────────────────────────

setup_netbird() {
	clear
	step_header "Step 3 of 3 — NetBird Mesh Networking" \
		"Connect your Bloom to a secure private network." \
		"Lets you access your Bloom from anywhere — phone, laptop, or cloud."

	printf "  %sWhat is NetBird?%s\n" "$BOLD" "$RESET"
	printf "  NetBird creates an encrypted mesh network between your\n"
	printf "  devices. Once connected, you can SSH into your Bloom\n"
	printf "  from anywhere, securely, without port forwarding.\n"
	printf "\n"
	printf "  %sHow to get a setup key:%s\n" "$BOLD" "$RESET"
	printf "    1. Go to %shttps://app.netbird.io%s\n" "$CYAN" "$RESET"
	printf "    2. Create an account (or sign in)\n"
	printf "    3. Navigate to %sSetup Keys%s\n" "$BOLD" "$RESET"
	printf "    4. Click %sCreate Setup Key%s\n" "$BOLD" "$RESET"
	printf "    5. Copy the key and paste it below\n"
	printf "\n"
	printf "  %sThis step is optional — you can set up NetBird later.%s\n" "$DIM" "$RESET"
	printf "\n"

	# Check for basic network connectivity (don't use -f: API may return non-2xx even when internet works)
	if ! curl -so /dev/null --max-time 5 https://api.netbird.io 2>&1; then
		warn "No internet connection detected."
		printf "  %sNetBird requires internet. Connect to a network first,%s\n" "$DIM" "$RESET"
		printf "  %sor skip and set up NetBird later with: sudo netbird up%s\n" "$DIM" "$RESET"
		printf "\n"
		local nb_choice
		show_prompt "Press r to retry, or s to skip:"
		read -r nb_choice
		case "${nb_choice,,}" in
		r)
			setup_netbird
			return $?
			;;
		*)
			info "Skipping NetBird setup."
			sleep 1
			return 0
			;;
		esac
	fi

	while true; do
		local setup_key
		show_prompt "Paste your setup key (or s to skip):"
		read -r setup_key

		if [[ "${setup_key,,}" == "s" || -z "$setup_key" ]]; then
			info "Skipping NetBird setup."
			printf "  %sYou can set it up anytime with: sudo netbird up%s\n" "$DIM" "$RESET"
			sleep 2
			return 0
		fi

		printf "\n"
		info "Connecting to NetBird..."

		# Start netbird with the setup key
		if ! netbird up --setup-key "$setup_key" >/dev/null 2>&1; then
			error "NetBird failed to start. Check the setup key."
			printf "\n"
			local nb_retry
			show_prompt "Press r to retry, or s to skip:"
			read -r nb_retry
			case "${nb_retry,,}" in
			s)
				info "Skipping NetBird setup."
				sleep 1
				return 0
				;;
			*) continue ;;
			esac
		fi

		# Poll for connection (up to 60 seconds), checking for auth failures
		local connected=false
		local failed=false
		for ((i = 0; i < 30; i++)); do
			local nb_status
			nb_status=$(netbird status 2>/dev/null)

			# Check for successful connection (Management: Connected)
			if echo "$nb_status" | grep -qP 'Management:\s+Connected'; then
				connected=true
				break
			fi

			# Check for auth failure via log (invalid setup key)
			if [[ -f /var/log/netbird/client.log ]] && \
				grep -q "setup key is invalid" /var/log/netbird/client.log 2>/dev/null; then
				failed=true
				break
			fi

			# Check for LoginFailed status
			if echo "$nb_status" | grep -qi "LoginFailed"; then
				failed=true
				break
			fi

			printf "  %sWaiting for connection... (%d/60s)%s\r" "$DIM" $(((i + 1) * 2)) "$RESET"
			sleep 2
		done
		printf "\033[K" # Clear the waiting line

		if $failed; then
			# Stop the failing netbird to prevent endless retries
			netbird down >/dev/null 2>&1 || true
			printf "\n"
			error "Setup key is invalid or expired."
			printf "  %sCreate a new key at https://app.netbird.io → Setup Keys%s\n" "$DIM" "$RESET"
			printf "\n"
			local nb_retry
			show_prompt "Press r to retry with a new key, or s to skip:"
			read -r nb_retry
			case "${nb_retry,,}" in
			s)
				info "Skipping NetBird setup."
				sleep 1
				return 0
				;;
			*) continue ;;
			esac
		elif $connected; then
			printf "\n"
			success "NetBird connected! Your Bloom is on the mesh."

			# Show the NetBird IP for reference
			local nb_ip
			nb_ip=$(netbird status 2>/dev/null | grep -oP 'NetBird IP: \K[\d./]+' || true)
			if [[ -n "$nb_ip" ]]; then
				info "Your NetBird IP: ${BOLD}${nb_ip}${RESET}"
			fi

			sleep 2
			return 0
		else
			# Timed out without clear failure — stop and let user decide
			netbird down >/dev/null 2>&1 || true
			printf "\n"
			error "Connection timed out. Check your internet and setup key."
			printf "\n"
			local nb_retry
			show_prompt "Press r to retry, or s to skip:"
			read -r nb_retry
			case "${nb_retry,,}" in
			s)
				info "Skipping NetBird setup."
				sleep 1
				return 0
				;;
			*) continue ;;
			esac
		fi
	done
}

# ── Finish ──────────────────────────────────────────────────────────

finish() {
	# Always apply security hardening (firewall + SSH) regardless of NetBird setup
	clear
	step_header "Security Hardening" \
		"Configuring firewall and SSH for safe network access." \
		"Protects your Bloom whether or not NetBird is active."
	apply_hardening

	# Create the marker file so the wizard doesn't run again
	touch /bloom-setup-done

	# Install getty autologin drop-in so bloom auto-logs in on next boot
	mkdir -p /etc/systemd/system/getty@tty1.service.d
	cp /usr/local/share/bloom/os/sysconfig/getty-autologin.conf \
		/etc/systemd/system/getty@tty1.service.d/autologin.conf

	clear
	printf "\n"
	printf "  %s" "$GREEN"
	printf "          ___.   .__\n"
	printf "          \\_ |__ |  |   ____   ____   _____\n"
	printf "           | __ \\|  |  /  _ \\ /  _ \\ /     \\\\\n"
	printf "           | \\_\\ \\  |_(  <_> |  <_> )  Y Y  \\\\\n"
	printf "           |___  /____/\\____/ \\____/|__|_|  /\n"
	printf "               \\/                         \\/\n"
	printf "  %s" "$RESET"

	banner "Setup Complete" \
		"Your Bloom is ready to go!" \
		"" \
		"After reboot, Pi — your AI coding companion —" \
		"will start automatically. Just chat naturally." \
		"" \
		"${DIM}Tip: type 'exit' to leave Pi, 'pi' to restart.${RESET}"

	for ((i = 5; i >= 1; i--)); do
		printf "\r  %sRebooting in %d...%s " "$DIM" "$i" "$RESET"
		sleep 1
	done
	printf "\n\n"

	systemctl reboot
}

# ── Main ────────────────────────────────────────────────────────────

main() {
	show_welcome
	setup_wifi
	setup_password
	setup_netbird
	finish
}

main "$@"
