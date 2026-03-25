#!/usr/bin/env bash
# Final setup, AI, and post-promotion helpers for setup-wizard.sh.

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

step_bootc_switch() {
	echo ""
	echo "--- Update Guidance ---"
	echo "NixPI now runs from the canonical checkout at /srv/nixpi."
	echo ""
	echo "To refresh the local checkout later:"
	echo "  cd /srv/nixpi"
	echo "  git switch main"
	echo "  git pull --ff-only"
	echo ""
	echo "To rebuild from the canonical checkout:"
	echo "  cd /srv/nixpi"
	echo "  git switch main"
	echo "  sudo nixos-rebuild switch --flake /etc/nixos#nixpi"
	echo ""
	echo "If you need to clone the checkout again manually:"
	echo "  sudo install -d -o $USER -g $USER -m 0755 /srv/nixpi"
	echo "  git clone --branch ${NIXPI_BOOTSTRAP_BRANCH} ${NIXPI_BOOTSTRAP_REPO} /srv/nixpi"
	echo "  cd /srv/nixpi"
	echo "  git switch main"
	echo "  sudo nixos-rebuild switch --rollback"
	echo ""
	mark_done bootc_switch
}

finalize() {
	if [[ -e "$HOME/nixpi" && ! -d "$HOME/nixpi/.git" ]]; then
		rm -rf "$HOME/nixpi"
	fi
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
	touch "$SYSTEM_READY"
	if has_systemd_unit nixpi-daemon.service; then
		if ! root_command nixpi-finalize-service-systemctl enable nixpi-daemon.service; then
			echo "warning: failed to enable nixpi-daemon.service during wizard finalization" >&2
		fi
		if ! root_command nixpi-finalize-service-systemctl restart nixpi-daemon.service; then
			echo "warning: failed to start nixpi-daemon.service during wizard finalization" >&2
		fi
	fi
	if has_systemd_unit display-manager.service; then
		root_command nixpi-finalize-service-systemctl start display-manager.service || echo "warning: failed to start display-manager.service" >&2
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
	local network_activity_room=""
	if [[ -f /var/lib/nixpi/netbird-watcher/matrix-token ]]; then
		network_activity_room="#network-activity:$(hostname -s)"
	fi

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
	[[ -n "$network_activity_room" ]] && echo "  Network activity room: ${network_activity_room}"
	if [[ "$services" != "skipped" ]]; then
		echo "  Built-in services: ${services:-home chat}"
		echo ""
		print_service_access_summary "$services" "$mesh_ip" "$mesh_fqdn"
		echo ""
	fi
	[[ -n "$network_activity_room" ]] && echo "  Future NetBird peer events will appear there."
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
		echo "  Next: restore the Pi runtime under ~/nixpi and rebuild from /srv/nixpi if you want the full NixPI profile again."
	fi
	echo "========================================="
	echo ""
}
