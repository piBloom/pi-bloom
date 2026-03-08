# First-Boot Setup Wizard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace greetd/tuigreet with a first-boot setup wizard (WiFi, password, NetBird + hardening) that runs once, then reboots into getty autologin with Pi.

**Architecture:** A systemd oneshot service (`bloom-setup.service`) runs a bash wizard script as root before getty starts. The wizard collects WiFi config, bloom user password, and optional NetBird setup key. If NetBird is configured, firewall and SSH are hardened. A marker file (`/.bloom-setup-done`) gates subsequent boots into getty autologin.

**Tech Stack:** Bash, systemd, nmcli (WiFi), chpasswd (password), netbird CLI, firewalld, sshd

---

### Task 1: Create the getty autologin drop-in

This file will be installed by the wizard after setup completes. It is staged in the image at `/usr/local/share/bloom/os/sysconfig/` and copied into place by the wizard.

**Files:**
- Create: `os/sysconfig/getty-autologin.conf`

**Step 1: Create the drop-in file**

```ini
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin bloom --noclear %I $TERM
```

Note: The first empty `ExecStart=` clears the default, then the second sets the override. This is standard systemd drop-in pattern.

**Step 2: Verify syntax**

Visual inspection only — this is a 3-line systemd override. No test needed.

**Step 3: Commit**

```bash
git add os/sysconfig/getty-autologin.conf
git commit -m "feat(os): add getty autologin drop-in for post-setup boot"
```

---

### Task 2: Create the bloom-setup systemd service

**Files:**
- Create: `os/sysconfig/bloom-setup.service`

**Step 1: Create the service unit**

```ini
[Unit]
Description=Bloom First-Boot Setup Wizard
ConditionPathExists=!/bloom-setup-done
Before=getty@tty1.service
After=NetworkManager.service systemd-resolved.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/bloom-setup.sh
StandardInput=tty
StandardOutput=tty
TTYPath=/dev/tty1
TTYReset=yes
TTYVHangup=yes
RemainAfterExit=no

[Install]
WantedBy=multi-user.target
```

Key details:
- `ConditionPathExists=!/bloom-setup-done` — skips entirely after first boot (no process spawned)
- `Before=getty@tty1.service` — runs wizard before login prompt
- `After=NetworkManager.service` — ensures nmcli is available for WiFi
- `StandardInput=tty` + `TTYPath=/dev/tty1` — wizard reads/writes directly to VT1
- `Type=oneshot` — systemd waits for script to complete

**Step 2: Commit**

```bash
git add os/sysconfig/bloom-setup.service
git commit -m "feat(os): add bloom-setup systemd oneshot service"
```

---

### Task 3: Create the setup wizard script

This is the main wizard. It must be beautiful, educational, and beginner-friendly.

**Files:**
- Create: `os/sysconfig/bloom-setup.sh`

**Step 1: Create the wizard script**

The script structure:

```bash
#!/usr/bin/env bash
set -euo pipefail

# ── Colors & Symbols ──────────────────────────────────────────────
GREEN='\033[0;32m'  YELLOW='\033[1;33m'  RED='\033[0;31m'
CYAN='\033[0;36m'   DIM='\033[2m'        BOLD='\033[1m'
RESET='\033[0m'

OK="✓"  FAIL="✗"  ARROW="→"  BULLET="●"

# ── Helper Functions ──────────────────────────────────────────────

banner() { ... }        # Draws a box-drawing frame with title + body text
info() { ... }          # Cyan info message
success() { ... }       # Green ✓ message
warn() { ... }          # Yellow message
error() { ... }         # Red ✗ message
prompt() { ... }        # Yellow prompt with read

# ── Welcome Screen ────────────────────────────────────────────────
# ASCII art bloom logo, welcome text explaining what will happen

# ── Step 1: WiFi ──────────────────────────────────────────────────
# Check for WiFi hardware: nmcli -t -f TYPE dev | grep wifi
# If present:
#   - nmcli dev wifi rescan
#   - nmcli -t -f SSID,SIGNAL,SECURITY dev wifi list
#   - Deduplicate by SSID, sort by signal desc
#   - Show numbered list with signal bars (▂▄▆█)
#   - User picks number or 's' to skip
#   - Read password (hidden)
#   - nmcli dev wifi connect "$SSID" password "$PASS"
#   - Retry loop on failure
# Educational text:
#   What: "Connect to WiFi so your Bloom can reach the internet."
#   Why:  "Needed for updates, NetBird mesh networking, and services."

# ── Step 2: Password ─────────────────────────────────────────────
# Loop:
#   - read -sp for password (hidden)
#   - read -sp for confirmation
#   - Check match
#   - Check length >= 8
#   - echo "bloom:$PASS" | chpasswd
# Educational text:
#   What: "Create a password for your Bloom user account."
#   Why:  "Protects your Bloom. Used for login, sudo, and remote access."

# ── Step 3: NetBird ──────────────────────────────────────────────
# Check network connectivity first (ping -c1 -W3 netbird.io)
# If no network, warn and offer skip
# Educational text explaining NetBird + how to get setup key
# Read setup key or 's' to skip
# netbird up --setup-key "$KEY"
# Poll: netbird status | grep -q "Connected" (timeout 30s)
# If connected:
#   apply_hardening()
# If failed:
#   offer retry or skip

# ── Security Hardening (automatic after NetBird) ─────────────────
apply_hardening() {
  # Firewall:
  #   firewall-cmd --permanent --new-zone=bloom
  #   firewall-cmd --permanent --set-default-zone=bloom
  #   firewall-cmd --permanent --zone=bloom --add-interface=wt0
  #   Detect local subnets from active interfaces (ip -4 -o addr)
  #   firewall-cmd --permanent --zone=bloom --add-rich-rule='rule family="ipv4" source address="<subnet>" service name="ssh" accept'
  #   firewall-cmd --permanent --zone=bloom --add-rich-rule='rule family="ipv4" source address="0.0.0.0/0" drop'
  #   (wt0 interface allows all traffic from mesh peers)
  #   firewall-cmd --reload
  #
  # SSH:
  #   Write /etc/ssh/sshd_config.d/bloom.conf:
  #     PasswordAuthentication yes
  #     AllowUsers bloom
  #     PermitRootLogin no
  #     MaxAuthTries 3
  #     LoginGraceTime 30
  #   systemctl restart sshd
}

# ── Finish ────────────────────────────────────────────────────────
# touch /bloom-setup-done
# Install getty autologin drop-in:
#   mkdir -p /etc/systemd/system/getty@tty1.service.d
#   cp /usr/local/share/bloom/os/sysconfig/getty-autologin.conf \
#      /etc/systemd/system/getty@tty1.service.d/autologin.conf
# Show completion screen with countdown
# systemctl reboot
```

The full script should be ~300-400 lines of bash. Each section clears the screen and draws a fresh box frame. The welcome screen features a bloom ASCII art logo.

**Step 2: Make it executable and ShellCheck clean**

```bash
shellcheck os/sysconfig/bloom-setup.sh
```

Expected: no errors, possibly some warnings about `read -sp` (safe to ignore).

**Step 3: Commit**

```bash
git add os/sysconfig/bloom-setup.sh
git commit -m "feat(os): add first-boot setup wizard script"
```

---

### Task 4: Update the Containerfile

Remove greetd/tuigreet, add bloom-setup service, keep display stack.

**Files:**
- Modify: `os/Containerfile`

**Step 1: Remove greetd and tuigreet from packages (lines 39-40)**

Replace:
```
    greetd \
    tuigreet \
```
With:
```
    openssh-server \
    firewalld \
```

We add `openssh-server` (for remote password login) and `firewalld` (for hardening). Both may already be in the base image but explicit is better.

**Step 2: Remove greetd config lines (lines 95-96)**

Remove:
```dockerfile
# Display stack: greetd + Xpra + Xvfb + i3 (agent-native, headless-first)
COPY os/sysconfig/greetd.toml /etc/greetd/config.toml
```

Replace with:
```dockerfile
# Display stack: Xpra + Xvfb + i3 (agent-native, headless-first)
```

**Step 3: Remove greetd enable (line 119)**

Remove:
```dockerfile
RUN systemctl enable greetd.service
```

**Step 4: Add bloom-setup service**

After the bloom-greeting.sh section, add:

```dockerfile
# First-boot setup wizard (runs once on VT1, creates password, configures WiFi/NetBird)
COPY os/sysconfig/bloom-setup.sh /usr/local/bin/bloom-setup.sh
RUN chmod +x /usr/local/bin/bloom-setup.sh
COPY os/sysconfig/bloom-setup.service /usr/lib/systemd/system/bloom-setup.service
RUN systemctl enable bloom-setup.service

# Getty autologin drop-in — staged here, installed by setup wizard after first boot
# (NOT installed into systemd yet — wizard copies it to /etc/systemd/system/getty@tty1.service.d/)
```

**Step 5: Update boot target comment (line 118)**

Change:
```dockerfile
# Boot to graphical target — greetd handles console, bloom-display handles virtual display
```
To:
```dockerfile
# Boot to multi-user target — bloom-setup handles first boot, getty handles login
```

And change:
```dockerfile
RUN systemctl set-default graphical.target
```
To:
```dockerfile
RUN systemctl set-default multi-user.target
```

Note: `bloom-display.service` should be `WantedBy=multi-user.target` too, or started by the setup wizard. Check and update if needed.

**Step 6: Enable sshd**

Add after the NetBird section:
```dockerfile
RUN systemctl enable sshd.service
```

**Step 7: Verify Containerfile is syntactically valid**

Visual review — Containerfiles don't have a linter in the project. The build step (Task 6) validates.

**Step 8: Commit**

```bash
git add os/Containerfile
git commit -m "refactor(os): replace greetd with bloom-setup wizard and getty autologin"
```

---

### Task 5: Update bib-config.toml and remove greetd.toml

**Files:**
- Modify: `os/bib-config.toml`
- Delete: `os/sysconfig/greetd.toml`

**Step 1: Update bib-config.toml**

```toml
# Bloom OS — bootc-image-builder user configuration
# NEVER commit bib-config.toml — it is gitignored.

[customizations]

[[customizations.user]]
name = "bloom"
password = "!"
groups = ["wheel"]
```

The `!` locks the password — the user exists but cannot login until the wizard sets a real password via `chpasswd`.

**Step 2: Delete greetd.toml**

```bash
git rm os/sysconfig/greetd.toml
```

**Step 3: Commit**

```bash
git add os/bib-config.toml os/sysconfig/greetd.toml
git commit -m "chore(os): lock bloom password in BIB config, remove greetd.toml"
```

Note: bib-config.toml is gitignored, so this commit only includes the greetd.toml removal. The bib-config change is local-only.

---

### Task 6: Update bloom-display.service WantedBy

Since we're switching from `graphical.target` to `multi-user.target`, the display service needs to start under multi-user too.

**Files:**
- Modify: `os/sysconfig/bloom-display.service`

**Step 1: Update WantedBy**

Change:
```ini
WantedBy=graphical.target
```
To:
```ini
WantedBy=multi-user.target
```

**Step 2: Commit**

```bash
git add os/sysconfig/bloom-display.service
git commit -m "fix(os): start bloom-display under multi-user.target"
```

---

### Task 7: Update first-boot skill

Remove NetBird from the Pi skill since it's now handled by the OS wizard.

**Files:**
- Modify: `skills/first-boot/SKILL.md`

**Step 1: Remove NetBird section**

Remove the entire "1) NetBird Mesh Networking" section (lines 24-44). Renumber remaining steps.

**Step 2: Add note about wizard**

At the top, after the prerequisite check, add:

```markdown
## What the OS Setup Wizard Already Handled

Before Pi starts, the Bloom OS setup wizard has already configured:
- WiFi network connection
- User password for the `bloom` account
- NetBird mesh networking (if user provided a setup key)
- SSH and firewall hardening (if NetBird was configured)

This skill handles the remaining software-level setup.
```

**Step 3: Renumber steps**

- Git Identity → Step 1
- dufs Setup → Step 2
- Optional Services → Step 3
- Mark Setup Complete → Step 4

**Step 4: Commit**

```bash
git add skills/first-boot/SKILL.md
git commit -m "docs(first-boot): remove NetBird step, handled by OS wizard"
```

---

### Task 8: Update documentation

**Files:**
- Modify: `CLAUDE.md` (if architecture section references greetd)
- Modify: `docs/pibloom-setup.md` (if it references greetd or login flow)

**Step 1: Check and update CLAUDE.md**

No greetd references expected in CLAUDE.md architecture section. Verify and skip if clean.

**Step 2: Check and update pibloom-setup.md**

Update any references to greetd/tuigreet login flow to describe the new wizard + getty flow.

**Step 3: Commit**

```bash
git add CLAUDE.md docs/pibloom-setup.md
git commit -m "docs: update references from greetd to setup wizard + getty"
```

---

### Task 9: Build and test in VM

This is the integration test — build the image and verify the wizard works.

**Step 1: Build the container image**

```bash
just build
```

Expected: successful podman build with no errors.

**Step 2: Generate qcow2**

```bash
just qcow2
```

Expected: BIB generates disk image successfully.

**Step 3: Boot VM and test wizard**

```bash
just vm
```

Verify:
1. Wizard appears on VT1 (not a login prompt)
2. WiFi step shows if hardware present (in QEMU, likely no WiFi — should auto-skip or show "no WiFi detected")
3. Password step works — set password, confirm
4. NetBird step — skip for VM testing (no network to mesh)
5. Reboot happens automatically
6. After reboot: auto-login as bloom, Pi starts
7. Manual logout → `login:` prompt → password works

**Step 4: Test serial mode**

```bash
just vm-serial
```

Verify same flow works on serial console.

---

## Task Dependency Graph

```
Task 1 (getty drop-in) ─────────┐
Task 2 (systemd service) ───────┤
Task 3 (wizard script) ─────────┼──→ Task 4 (Containerfile) ──→ Task 9 (build+test)
Task 5 (bib-config + rm greetd)─┤
Task 6 (display service) ───────┘
Task 7 (first-boot skill) ──────────→ Task 8 (docs)
```

Tasks 1, 2, 3, 5, 6, 7 are independent and can be parallelized.
Task 4 depends on 1, 2, 3, 5, 6.
Task 8 depends on 7.
Task 9 depends on all previous tasks.
