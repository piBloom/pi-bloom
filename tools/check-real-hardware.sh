#!/usr/bin/env bash
set -euo pipefail

if [ $# -ne 1 ]; then
    echo "Usage: $0 <ip-or-hostname>"
    exit 1
fi

target="$1"
ssh_opts="-o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes"

pass_count=0
fail_count=0

run_check() {
    local label="$1"
    local cmd="$2"
    if ssh $ssh_opts "pi@$target" "$cmd" &>/dev/null; then
        echo "PASS  $label"
        pass_count=$((pass_count + 1))
    else
        echo "FAIL  $label"
        fail_count=$((fail_count + 1))
    fi
}

echo "Bloom OS hardware check: $target"
echo "-----------------------------------"

run_check "UEFI boot mode"            "[ -d /sys/firmware/efi ]"
run_check "Root filesystem mounted"   "mountpoint -q /"
run_check "Boot filesystem mounted"   "mountpoint -q /boot"
run_check "systemd-boot present"      "[ -f /boot/EFI/systemd/systemd-bootx64.efi ]"
run_check "Network reachable"         "ping -c1 1.1.1.1"
run_check "NetworkManager active"     "systemctl is-active NetworkManager"
run_check "Pi daemon healthy"         "systemctl is-active nixpi-daemon"
run_check "Chat service healthy"      "systemctl is-active nixpi-chat"
run_check "Chat UI accessible"        "curl -sf http://localhost:8080"

# Setup wizard state check (non-binary: report status either way)
echo -n "INFO  Setup wizard state — "
if ssh $ssh_opts "pi@$target" "[ -f ~/.nixpi/wizard-state/system-ready ]" &>/dev/null; then
    echo "setup complete"
else
    echo "setup pending"
fi

echo "-----------------------------------"
echo "Results: $pass_count passed, $fail_count failed"

if [ "$fail_count" -gt 0 ]; then
    exit 1
fi
