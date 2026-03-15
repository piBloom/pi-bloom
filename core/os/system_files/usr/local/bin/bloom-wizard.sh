#!/usr/bin/env bash
# bloom-wizard.sh — First-boot setup wizard for Bloom OS.
# Runs on first login before Pi starts. Uses read -p prompts.
# Each completed step writes a checkpoint to ~/.bloom/wizard-state/.
# If interrupted (Ctrl+C), resumes from the last incomplete step on next login.
set -euo pipefail

WIZARD_STATE="$HOME/.bloom/wizard-state"
SETUP_COMPLETE="$HOME/.bloom/.setup-complete"
BLOOM_DIR="${BLOOM_DIR:-$HOME/Bloom}"
BLOOM_SERVICES="/usr/local/share/bloom/services"
QUADLET_DIR="$HOME/.config/containers/systemd"
SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
BLOOM_CONFIG="$HOME/.config/bloom"
PI_DIR="$HOME/.pi"
MATRIX_HOMESERVER="http://localhost:6167"
MATRIX_STATE_DIR="$WIZARD_STATE/matrix-state"

# --- Checkpoint helpers ---

step_done() { [[ -f "$WIZARD_STATE/$1" ]]; }

mark_done() {
	mkdir -p "$WIZARD_STATE"
	echo "$(date -Iseconds)" > "$WIZARD_STATE/$1"
}

# Store data alongside a checkpoint (e.g., mesh IP)
mark_done_with() {
	mkdir -p "$WIZARD_STATE"
	printf '%s\n%s\n' "$(date -Iseconds)" "$2" > "$WIZARD_STATE/$1"
}

# Read stored data from a checkpoint (line 2+)
read_checkpoint_data() {
	[[ -f "$WIZARD_STATE/$1" ]] && sed -n '2p' "$WIZARD_STATE/$1" || echo ""
}

netbird_status_json() {
	netbird status --json 2>/dev/null || true
}

netbird_fqdn() {
	local status
	status=$(netbird_status_json)
	[[ -n "$status" ]] || return 0
	echo "$status" | sed -n 's/.*"fqdn":"\([^"]*\)".*/\1/p' | head -n1
}

netbird_ip() {
	local status
	status=$(netbird_status_json)
	[[ -n "$status" ]] || return 0
	echo "$status" | sed -n 's/.*"netbirdIp":"\([^"]*\)".*/\1/p' | sed 's#/.*##' | head -n1
}

# --- Matrix state helpers ---

matrix_state_get() {
	[[ -f "$MATRIX_STATE_DIR/$1" ]] && cat "$MATRIX_STATE_DIR/$1" || true
}

matrix_state_set() {
	mkdir -p "$MATRIX_STATE_DIR"
	printf '%s' "$2" > "$MATRIX_STATE_DIR/$1"
}

matrix_state_clear() {
	rm -rf "$MATRIX_STATE_DIR"
}

# --- Matrix helpers ---

# Generate a secure random password (base64url, 32 chars)
generate_password() {
	openssl rand -base64 24 | tr '+/' '-_'
}

# Extract a JSON string field value (simple — no jq dependency)
# Usage: json_field '{"key":"value"}' "key" → value
json_field() {
	echo "$1" | sed -n "s/.*\"$2\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p"
}

# Register a Matrix account via the UIA flow.
# Usage: matrix_register <username> <password> <registration_token>
# Outputs: JSON with user_id and access_token on success, exits 1 on failure
matrix_register() {
	local username="$1" password="$2" reg_token="$3"
	local url="${MATRIX_HOMESERVER}/_matrix/client/v3/register"

	# Step 1: POST without auth — expect 401 with session ID and UIA flows
	local step1
	step1=$(curl -s -X POST "$url" \
		-H "Content-Type: application/json" \
		-d "{\"username\":\"${username}\",\"password\":\"${password}\",\"inhibit_login\":false}")

	# If step1 succeeded directly (no UIA needed), return it
	if echo "$step1" | grep -q '"access_token"'; then
		echo "$step1"
		return 0
	fi

	# Extract session from 401 response body
	local session
	session=$(json_field "$step1" "session")

	if [[ -z "$session" ]]; then
		echo "ERROR: Failed to get session ID from Matrix server" >&2
		return 1
	fi

	# Step 2: POST with registration token
	local step2
	step2=$(curl -s -X POST "$url" \
		-H "Content-Type: application/json" \
		-d "{\"username\":\"${username}\",\"password\":\"${password}\",\"inhibit_login\":false,\"auth\":{\"type\":\"m.login.registration_token\",\"token\":\"${reg_token}\",\"session\":\"${session}\"}}")

	if ! echo "$step2" | grep -q '"access_token"'; then
		echo "ERROR: Matrix registration failed for ${username}" >&2
		return 1
	fi

	echo "$step2"
	return 0
}

# Password-login an existing Matrix account.
# Usage: matrix_login <username> <password>
# Outputs: JSON with user_id and access_token on success, exits 1 on failure
matrix_login() {
	local username="$1" password="$2"
	local url="${MATRIX_HOMESERVER}/_matrix/client/v3/login"
	local result
	result=$(curl -s -X POST "$url" \
		-H "Content-Type: application/json" \
		-d "{\"type\":\"m.login.password\",\"identifier\":{\"type\":\"m.id.user\",\"user\":\"${username}\"},\"password\":\"${password}\"}")

	if ! echo "$result" | grep -q '"access_token"'; then
		return 1
	fi

	echo "$result"
	return 0
}

load_existing_matrix_credentials() {
	[[ -f "$PI_DIR/matrix-credentials.json" ]] || return 0
	local raw
	raw=$(cat "$PI_DIR/matrix-credentials.json" 2>/dev/null || true)
	[[ -n "$raw" ]] || return 0

	local bot_token bot_user_id bot_password user_user_id user_password username reg_token
	bot_token=$(json_field "$raw" "botAccessToken")
	bot_user_id=$(json_field "$raw" "botUserId")
	bot_password=$(json_field "$raw" "botPassword")
	user_user_id=$(json_field "$raw" "userUserId")
	user_password=$(json_field "$raw" "userPassword")
	reg_token=$(json_field "$raw" "registrationToken")

	if [[ -n "$bot_token" ]]; then matrix_state_set bot_token "$bot_token"; fi
	if [[ -n "$bot_user_id" ]]; then matrix_state_set bot_user_id "$bot_user_id"; fi
	if [[ -n "$bot_password" ]]; then matrix_state_set bot_password "$bot_password"; fi
	if [[ -n "$user_user_id" ]]; then matrix_state_set user_user_id "$user_user_id"; fi
	if [[ -n "$user_password" ]]; then matrix_state_set user_password "$user_password"; fi
	if [[ -n "$reg_token" ]]; then matrix_state_set reg_token "$reg_token"; fi

	if [[ "$user_user_id" =~ ^@([^:]+): ]]; then
		username="${BASH_REMATCH[1]}"
		matrix_state_set username "$username"
	fi
}

default_model_for_provider() {
	case "$1" in
		anthropic) echo "claude-sonnet-4-6" ;;
		openai) echo "codex-mini-latest" ;;
		google) echo "gemini-2.5-pro" ;;
		openrouter) echo "auto" ;;
		*) return 1 ;;
	esac
}

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
	local installed_services="$1" mesh_ip="$2" mesh_fqdn="$3"
	local mesh_host="${mesh_fqdn:-$mesh_ip}"

	echo "  Service access:"
	if [[ -n "$mesh_host" ]]; then
		echo "    Bloom Home   - http://${mesh_host}:8080"
	fi
	if [[ -n "$mesh_ip" && "$mesh_ip" != "$mesh_host" ]]; then
		echo "    Bloom Home   - http://${mesh_ip}:8080"
	fi
	echo "    Share this   - send other NetBird peers the Bloom Home URL"
	if [[ "$installed_services" == *"cinny"* ]]; then
		if [[ -n "$mesh_host" ]]; then
			echo "    Bloom Web Chat - http://${mesh_host}:8081"
		fi
		if [[ -n "$mesh_ip" && "$mesh_ip" != "$mesh_host" ]]; then
			echo "    Bloom Web Chat - http://${mesh_ip}:8081"
		fi
		echo "    Cinny        - preconfigured for this Bloom server"
	else
		echo "    Cinny        - not installed on this box"
	fi

	if [[ "$installed_services" == *"dufs"* ]]; then
		if [[ -n "$mesh_host" ]]; then
			echo "    dufs/WebDAV  - http://${mesh_host}:5000"
		fi
		if [[ -n "$mesh_ip" && "$mesh_ip" != "$mesh_host" ]]; then
			echo "    dufs/WebDAV  - http://${mesh_ip}:5000"
		fi
		echo "    dufs path    - ~/Public/Bloom"
	fi

	if [[ -n "$mesh_host" ]]; then
		echo "    Matrix       - http://${mesh_host}:6167"
	fi
	if [[ -n "$mesh_ip" && "$mesh_ip" != "$mesh_host" ]]; then
		echo "    Matrix       - http://${mesh_ip}:6167"
	fi
	echo "    Matrix       - http://localhost:6167 (local access on the box)"
}

write_service_home_runtime() {
	local installed_services="$1" mesh_ip="$2" mesh_fqdn="$3"
	local mesh_host page_url generated_at
	mesh_host="${mesh_fqdn:-$mesh_ip}"
	[[ -n "$mesh_host" ]] || mesh_host="localhost"
	page_url="http://${mesh_host}:8080"
	generated_at=$(date -Iseconds)

	mkdir -p "$BLOOM_CONFIG/home"
	cat > "$BLOOM_CONFIG/home/index.html" <<-HTML
	<!doctype html>
	<html lang="en">
	<head>
	  <meta charset="utf-8" />
	  <meta name="viewport" content="width=device-width, initial-scale=1" />
	  <title>Bloom Home</title>
	  <style>
	    :root {
	      color-scheme: light;
	      --bg: #f4efe4;
	      --panel: rgba(255, 252, 245, 0.92);
	      --panel-strong: #fffaf0;
	      --ink: #1f2a2e;
	      --muted: #5f6d68;
	      --line: rgba(31, 42, 46, 0.12);
	      --accent: #d66b2c;
	      --live: #2a7a4b;
	      --idle: #8a6d3b;
	      --shadow: 0 18px 50px rgba(63, 44, 17, 0.12);
	      font-family: "IBM Plex Sans", "Avenir Next", sans-serif;
	    }
	    * { box-sizing: border-box; }
	    body {
	      margin: 0;
	      min-height: 100vh;
	      background:
	        radial-gradient(circle at top left, rgba(214, 107, 44, 0.2), transparent 28%),
	        radial-gradient(circle at top right, rgba(53, 113, 132, 0.16), transparent 24%),
	        linear-gradient(180deg, #f8f2e8 0%, var(--bg) 100%);
	      color: var(--ink);
	    }
	    main {
	      max-width: 1100px;
	      margin: 0 auto;
	      padding: 32px 20px 48px;
	    }
	    .hero, .service-card, .footer-note {
	      background: var(--panel);
	      border: 1px solid var(--line);
	      border-radius: 24px;
	      box-shadow: var(--shadow);
	      backdrop-filter: blur(12px);
	    }
	    .hero {
	      padding: 28px;
	      margin-bottom: 20px;
	    }
	    .eyebrow {
	      margin: 0 0 10px;
	      letter-spacing: 0.14em;
	      text-transform: uppercase;
	      font-size: 0.75rem;
	      color: var(--muted);
	    }
	    h1 {
	      margin: 0;
	      font-family: "IBM Plex Serif", Georgia, serif;
	      font-size: clamp(2rem, 4vw, 3.5rem);
	      line-height: 0.95;
	    }
	    .hero p {
	      max-width: 60ch;
	      color: var(--muted);
	      font-size: 1rem;
	      line-height: 1.55;
	    }
	    .share-grid, .services-grid {
	      display: grid;
	      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
	      gap: 16px;
	    }
	    .share-grid {
	      margin-top: 22px;
	      gap: 14px;
	    }
	    .share-card {
	      padding: 16px 18px;
	      border-radius: 18px;
	      background: var(--panel-strong);
	      border: 1px solid var(--line);
	    }
	    code {
	      display: inline-block;
	      margin-top: 8px;
	      padding: 9px 12px;
	      border-radius: 999px;
	      background: #1f2a2e;
	      color: #fffaf0;
	      font-size: 0.95rem;
	    }
	    .service-card {
	      padding: 20px;
	    }
	    .service-head {
	      display: grid;
	      grid-template-columns: 62px 1fr auto;
	      gap: 14px;
	      align-items: start;
	      margin-bottom: 18px;
	    }
	    .service-icon {
	      width: 62px;
	      height: 62px;
	      border-radius: 18px;
	      display: grid;
	      place-items: center;
	      font-weight: 700;
	      letter-spacing: 0.08em;
	      background: linear-gradient(135deg, var(--accent), #f1b24a);
	      color: #fffaf0;
	    }
	    .service-card h2 {
	      margin: 0 0 6px;
	      font-size: 1.2rem;
	    }
	    .service-description, .service-meta, .footer-note {
	      margin: 0;
	      color: var(--muted);
	      line-height: 1.5;
	    }
	    .service-meta {
	      display: flex;
	      flex-direction: column;
	      gap: 6px;
	      margin-top: 12px;
	    }
	    .service-label {
	      text-transform: uppercase;
	      letter-spacing: 0.08em;
	      font-size: 0.76rem;
	      color: var(--muted);
	    }
	    .service-link {
	      color: var(--ink);
	      text-decoration-thickness: 2px;
	      text-underline-offset: 3px;
	      word-break: break-all;
	    }
	    .service-status {
	      padding: 8px 10px;
	      border-radius: 999px;
	      font-size: 0.78rem;
	      font-weight: 700;
	      text-transform: uppercase;
	      letter-spacing: 0.06em;
	    }
	    .status-live {
	      background: rgba(42, 122, 75, 0.12);
	      color: var(--live);
	    }
	    .status-idle {
	      background: rgba(138, 109, 59, 0.14);
	      color: var(--idle);
	    }
	    .footer-note {
	      margin-top: 18px;
	      padding: 16px 18px;
	      font-size: 0.92rem;
	    }
	    @media (max-width: 720px) {
	      main { padding: 20px 14px 36px; }
	      .hero { padding: 22px; }
	      .service-head { grid-template-columns: 62px 1fr; }
	      .service-status {
	        grid-column: 1 / -1;
	        justify-self: start;
	      }
	    }
	  </style>
	</head>
	<body>
	  <main>
	    <section class="hero">
	      <p class="eyebrow">Bloom Home</p>
	      <h1>Service access for this Bloom node</h1>
	      <p>Use this page to remember which NetBird URL to open, which hostname or IP to share with other peers, and which local path each service exposes.</p>
	      <div class="share-grid">
	        <div class="share-card">
	          <p class="eyebrow">Share this page</p>
	          <code>${page_url}</code>
	        </div>
	        <div class="share-card">
	          <p class="eyebrow">Preferred host for services</p>
	          <code>${mesh_host}</code>
	        </div>
	      </div>
	    </section>
	    <section class="services-grid">
	HTML

	{
		cat <<-HTML
	    <article class="service-card">
	      <div class="service-head">
	        <div class="service-icon">HM</div>
	        <div>
	          <h2>Bloom Home</h2>
	          <p class="service-description">NetBird landing page showing installed services and shareable access URLs</p>
	        </div>
	        <span class="service-status status-live">Running</span>
	      </div>
	      <p class="service-meta"><span class="service-label">URL</span><a class="service-link" href="${page_url}">${page_url}</a></p>
	    </article>
	HTML

		if [[ "$installed_services" == *"cinny"* ]]; then
			cat <<-HTML
	    <article class="service-card">
	      <div class="service-head">
	        <div class="service-icon">MX</div>
	        <div>
	          <h2>Bloom Web Chat</h2>
	          <p class="service-description">Browser Matrix client preconfigured for this Bloom node</p>
	        </div>
	        <span class="service-status status-live">Running</span>
	      </div>
	      <p class="service-meta"><span class="service-label">URL</span><a class="service-link" href="http://${mesh_host}:8081">http://${mesh_host}:8081</a></p>
	    </article>
	HTML
		fi

		if [[ "$installed_services" == *"dufs"* ]]; then
			cat <<-HTML
	    <article class="service-card">
	      <div class="service-head">
	        <div class="service-icon">FS</div>
	        <div>
	          <h2>Bloom Files</h2>
	          <p class="service-description">WebDAV share for the intentional cross-device Bloom folder</p>
	        </div>
	        <span class="service-status status-live">Running</span>
	      </div>
	      <p class="service-meta"><span class="service-label">URL</span><a class="service-link" href="http://${mesh_host}:5000">http://${mesh_host}:5000</a></p>
	      <p class="service-meta"><span class="service-label">Path</span>~/Public/Bloom</p>
	    </article>
	HTML
		fi
	} >> "$BLOOM_CONFIG/home/index.html"

	cat >> "$BLOOM_CONFIG/home/index.html" <<-HTML
	    </section>
	    <section class="footer-note">
	      Generated ${generated_at}. URLs prefer the current NetBird FQDN when available, then fall back to the mesh IP.
	    </section>
	  </main>
	</body>
	</html>
	HTML
}

install_home_infrastructure() {
	mkdir -p "$QUADLET_DIR" "$BLOOM_CONFIG/home"
	cat > "$QUADLET_DIR/bloom-home.container" <<-'UNIT'
	[Unit]
	Description=Bloom Home - NetBird service landing page
	After=network-online.target
	Wants=network-online.target

	[Container]
	Image=docker.io/library/nginx:1.29.1-alpine
	ContainerName=bloom-home

	PublishPort=8080:80

	Volume=%h/.config/bloom/home:/usr/share/nginx/html:ro

	PodmanArgs=--memory=96m
	PodmanArgs=--security-opt label=disable
	NoNewPrivileges=true
	LogDriver=journald

	[Service]
	Restart=on-failure
	RestartSec=10
	TimeoutStartSec=120

	[Install]
	WantedBy=default.target
	UNIT

	systemctl --user daemon-reload
	systemctl --user start bloom-home.service
}

write_cinny_runtime_config() {
	local mesh_fqdn mesh_ip primary_host primary_matrix_url fallback_matrix_url
	mesh_fqdn=$(netbird_fqdn)
	mesh_ip=$(netbird_ip)
	primary_host="${mesh_fqdn:-$mesh_ip}"
	primary_matrix_url="http://localhost:6167"
	fallback_matrix_url=""

	if [[ -n "$primary_host" ]]; then
		primary_matrix_url="http://${primary_host}:6167"
	fi
	if [[ -n "$mesh_fqdn" && -n "$mesh_ip" ]]; then
		fallback_matrix_url="http://${mesh_ip}:6167"
	fi

	mkdir -p "$BLOOM_CONFIG/cinny/.well-known/matrix"
	cat > "$BLOOM_CONFIG/cinny/config.json" <<-CONFIG
	{
	  "defaultHomeserver": 0,
	  "homeserverList": [
	    "${primary_matrix_url}"$( [[ -n "$fallback_matrix_url" ]] && printf ',\n    "%s"' "$fallback_matrix_url" )
	  ],
	  "allowCustomHomeservers": true,
	  "hashRouter": {
	    "enabled": true
	  }
	}
	CONFIG

	cat > "$BLOOM_CONFIG/cinny/.well-known/matrix/client" <<-WELLKNOWN
	{
	  "m.homeserver": {
	    "base_url": "${primary_matrix_url}",
	    "server_name": "bloom"
	  }
	}
	WELLKNOWN

	cat > "$BLOOM_CONFIG/cinny/nginx.conf" <<-'NGINX'
	server {
	    listen 80;
	    server_name _;

	    root /app;
	    index index.html;

	    location = /config.json {
	        add_header Cache-Control "no-store";
	        try_files /config.json =404;
	    }

	    location = /.well-known/matrix/client {
	        add_header Access-Control-Allow-Origin "*";
	        add_header Cache-Control "no-store";
	        default_type application/json;
	        try_files /.well-known/matrix/client =404;
	    }

	    location / {
	        try_files $uri /index.html;
	    }
	}
	NGINX
}

# --- Service install helper ---

# Install a service from the bundled package.
# Usage: install_service <name>
install_service() {
	local name="$1"
	local svc_dir="${BLOOM_SERVICES}/${name}"

	if [[ ! -d "$svc_dir" ]]; then
		echo "  Service package not found: ${svc_dir}" >&2
		return 1
	fi

	# Copy quadlet files (route .socket and .container to different dirs)
	mkdir -p "$QUADLET_DIR" "$SYSTEMD_USER_DIR"
	for f in "$svc_dir/quadlet/"*; do
		[[ -f "$f" ]] || continue
		case "$f" in
			*.socket) cp "$f" "$SYSTEMD_USER_DIR/" ;;
			*)        cp "$f" "$QUADLET_DIR/" ;;
		esac
	done

	# Copy config files (.json, .toml)
	mkdir -p "$BLOOM_CONFIG"
	for f in "$svc_dir"/*.json "$svc_dir"/*.toml; do
		[[ -f "$f" ]] || continue
		local basename
		basename=$(basename "$f")
		[[ -f "$BLOOM_CONFIG/$basename" ]] && continue
		cp "$f" "$BLOOM_CONFIG/$basename"
	done

	# Create empty env file if missing
	[[ -f "$BLOOM_CONFIG/${name}.env" ]] || touch "$BLOOM_CONFIG/${name}.env"

	if [[ "$name" == "dufs" ]]; then
		mkdir -p "$HOME/Public/Bloom"
	fi
	if [[ "$name" == "cinny" ]]; then
		write_cinny_runtime_config
	fi

	# Copy SKILL.md
	local skill_dir="$BLOOM_DIR/Skills/${name}"
	mkdir -p "$skill_dir"
	[[ -f "$svc_dir/SKILL.md" ]] && cp "$svc_dir/SKILL.md" "$skill_dir/"

	# Reload and start — Quadlet units are auto-enabled via WantedBy in .container,
	# so we only need to start (enable would fail on generator-created transient units)
	systemctl --user daemon-reload
	local target="bloom-${name}.service"
	# Prefer socket activation if socket unit exists
	[[ -f "$SYSTEMD_USER_DIR/bloom-${name}.socket" ]] && target="bloom-${name}.socket"
	systemctl --user start "$target"
}

# --- Step functions ---

step_welcome() {
	echo ""
	echo "Welcome to Bloom OS."
	echo "Let's configure your device. This takes a few minutes."
	echo "Press Ctrl+C at any time to abort — you'll resume where you left off next login."
	echo ""

	# Set hostname if not already set (bootc strips /etc/hostname from the image)
	if [[ "$(hostnamectl hostname 2>/dev/null)" != "bloom" ]]; then
		sudo hostnamectl set-hostname bloom 2>/dev/null || true
	fi

	mark_done welcome
}

step_password() {
	echo "--- Password ---"
	echo "First, let's change the default password."
	echo ""
	while ! passwd; do
		echo ""
		echo "Password change failed. Please try again."
	done
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
	while true; do
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
	while [[ ! -S /var/run/netbird.sock ]]; do
		wait_count=$((wait_count + 1))
		if [[ $wait_count -ge 20 ]]; then
			echo "ERROR: NetBird daemon did not start. Run 'sudo systemctl status netbird' to debug."
			return 1
		fi
		sleep 0.5
	done

	while true; do
		read -rp "Setup key: " setup_key
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

step_matrix() {
	echo ""
	echo "--- Matrix Messaging ---"
	echo "Setting up Matrix messaging..."
	echo ""

	# Wait for Matrix homeserver
	echo "Waiting for Matrix homeserver..."
	local attempts=0
	while ! systemctl is-active --quiet bloom-matrix.service; do
		attempts=$((attempts + 1))
		if [[ $attempts -ge 30 ]]; then
			echo "ERROR: bloom-matrix.service did not start within 30 seconds." >&2
			echo "Run 'systemctl status bloom-matrix' to debug." >&2
			return 1
		fi
		sleep 1
	done
	echo "Matrix homeserver is running."

	# Read registration token
	local reg_token
	reg_token=$(sudo cat /var/lib/continuwuity/registration_token 2>/dev/null || true)
	if [[ -z "$reg_token" ]]; then
		echo "ERROR: Could not read registration token." >&2
		return 1
	fi
	matrix_state_set reg_token "$reg_token"
	load_existing_matrix_credentials

	# Prompt for username
	local username
	username=$(matrix_state_get username)
	if [[ -z "$username" ]]; then
		while true; do
			read -rp "Choose a username for your Matrix account (cannot be changed later): " username
			if [[ -z "$username" ]]; then
				echo "Username cannot be empty."
				continue
			fi
			if [[ ! "$username" =~ ^[a-z][a-z0-9._-]*$ ]]; then
				echo "Username must start with a lowercase letter and contain only a-z, 0-9, '.', '_', '-'."
				continue
			fi
			matrix_state_set username "$username"
			break
		done
	else
		echo "Resuming Matrix setup for @${username}:bloom"
	fi

	# Register bot account
	local bot_password bot_token bot_user_id bot_result
	bot_password=$(matrix_state_get bot_password)
	bot_token=$(matrix_state_get bot_token)
	bot_user_id=$(matrix_state_get bot_user_id)
	if [[ -z "$bot_password" ]]; then
		bot_password=$(generate_password)
		matrix_state_set bot_password "$bot_password"
	fi
	if [[ -z "$bot_token" || -z "$bot_user_id" ]]; then
		echo "Creating or resuming Pi bot account..."
		bot_result=$(matrix_login "pi" "$bot_password" 2>/dev/null || true)
		if [[ -z "$bot_result" ]]; then
			bot_result=$(matrix_register "pi" "$bot_password" "$reg_token") || {
				echo "ERROR: Failed to register or recover @pi:bloom bot account." >&2
				return 1
			}
		fi
		bot_token=$(json_field "$bot_result" "access_token")
		bot_user_id=$(json_field "$bot_result" "user_id")
		matrix_state_set bot_token "$bot_token"
		matrix_state_set bot_user_id "$bot_user_id"
	fi

	# Register user account
	local user_password user_token user_user_id user_result
	user_password=$(matrix_state_get user_password)
	user_token=$(matrix_state_get user_token)
	user_user_id=$(matrix_state_get user_user_id)
	if [[ -z "$user_password" ]]; then
		user_password=$(generate_password)
		matrix_state_set user_password "$user_password"
	fi
	if [[ -z "$user_token" || -z "$user_user_id" ]]; then
		echo "Creating or resuming your account (@${username}:bloom)..."
		user_result=$(matrix_login "$username" "$user_password" 2>/dev/null || true)
		if [[ -z "$user_result" ]]; then
			user_result=$(matrix_register "$username" "$user_password" "$reg_token") || {
				echo "ERROR: Failed to register or recover @${username}:bloom account." >&2
				return 1
			}
		fi
		user_token=$(json_field "$user_result" "access_token")
		user_user_id=$(json_field "$user_result" "user_id")
		matrix_state_set user_token "$user_token"
		matrix_state_set user_user_id "$user_user_id"
	fi

	# Store credentials
	mkdir -p "$PI_DIR"
	cat > "$PI_DIR/matrix-credentials.json" <<-CREDS
	{
	  "homeserver": "${MATRIX_HOMESERVER}",
	  "botUserId": "${bot_user_id}",
	  "botAccessToken": "${bot_token}",
	  "botPassword": "${bot_password}",
	  "userUserId": "${user_user_id}",
	  "userPassword": "${user_password}",
	  "registrationToken": "${reg_token}"
	}
	CREDS
	chmod 600 "$PI_DIR/matrix-credentials.json"

	# Create #general:bloom room (bot creates, invites user)
	echo "Creating #general:bloom room..."
	curl -sf -X POST "${MATRIX_HOMESERVER}/_matrix/client/v3/createRoom" \
		-H "Authorization: Bearer ${bot_token}" \
		-H "Content-Type: application/json" \
		-d "{\"room_alias_name\":\"general\",\"invite\":[\"${user_user_id}\"]}" \
		>/dev/null 2>&1 || echo "  (room may already exist)"

	# User joins the room
	curl -sf -X POST "${MATRIX_HOMESERVER}/_matrix/client/v3/join/%23general%3Abloom" \
		-H "Authorization: Bearer ${user_token}" \
		-H "Content-Type: application/json" \
		-d '{}' \
		>/dev/null 2>&1 || true

	echo ""
	echo "Matrix ready."
	echo "  Username: ${username}"
	echo "  Password: ${user_password}"
	echo ""
	matrix_state_clear
	mark_done_with matrix "$username"
}

step_git() {
	echo ""
	echo "--- Git Identity ---"
	read -rp "Your name: " git_name
	read -rp "Email: " git_email

	[[ -n "$git_name" ]] && git config --global user.name "$git_name"
	[[ -n "$git_email" ]] && git config --global user.email "$git_email"

	echo "Git identity configured."
	mark_done git
}

step_ai() {
	echo ""
	echo "--- AI Provider ---"
	echo "Skipping API-key setup in the wizard."
	echo "After setup, run /login in Pi to authenticate,"
	echo "then /model to select your preferred AI model."
	mark_done_with ai "skipped"
}

step_services() {
	echo ""
	echo "--- Services ---"
	local installed=""
	local mesh_ip mesh_fqdn
	mesh_ip=$(read_checkpoint_data netbird)
	mesh_fqdn=$(netbird_fqdn)

	echo "  Provisioning Bloom Home landing page..."
	write_service_home_runtime "$installed" "$mesh_ip" "$mesh_fqdn"
	if install_home_infrastructure; then
		echo "  Bloom Home ready."
	else
		echo "  Bloom Home setup failed."
	fi

	read -rp "Install Bloom Web Chat? (Cinny web client for Matrix over NetBird) [y/N]: " cinny_answer
	if [[ "${cinny_answer,,}" == "y" ]]; then
		echo "  Installing Cinny..."
		if install_service cinny; then
			echo "  Cinny installed."
			installed="${installed} cinny"
			write_service_home_runtime "$installed" "$mesh_ip" "$mesh_fqdn"
		else
			echo "  Cinny installation failed."
		fi
	fi

	read -rp "Install dufs file server? (access files from any device via WebDAV) [y/N]: " dufs_answer
	if [[ "${dufs_answer,,}" == "y" ]]; then
		echo "  Installing dufs..."
		if install_service dufs; then
			echo "  dufs installed."
			installed="${installed} dufs"
			write_service_home_runtime "$installed" "$mesh_ip" "$mesh_fqdn"
		else
			echo "  dufs installation failed."
		fi
	fi

	write_service_home_runtime "$installed" "$mesh_ip" "$mesh_fqdn"
	mark_done_with services "${installed:-none}"
}

# --- Finalization ---

finalize() {
	touch "$SETUP_COMPLETE"
	loginctl enable-linger "$USER"
	if pi_ai_ready; then
		systemctl --user enable --now pi-daemon.service 2>/dev/null || true
	else
		systemctl --user disable --now pi-daemon.service 2>/dev/null || true
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

	echo ""
	echo "========================================="
	echo "  Setup complete!"
	echo ""
	[[ -n "$mesh_ip" ]] && echo "  Mesh IP: ${mesh_ip} (access from any NetBird peer)"
	[[ -n "$mesh_fqdn" ]] && echo "  NetBird name: ${mesh_fqdn}"
	[[ -n "$matrix_user" ]] && echo "  Matrix user: @${matrix_user}:bloom"
	echo "  Services:${services:-none}"
	echo ""
	print_service_access_summary "$services" "$mesh_ip" "$mesh_fqdn"
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

	finalize
}

main
