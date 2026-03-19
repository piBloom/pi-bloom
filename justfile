# Bloom OS — build, test, and deploy

system    := "x86_64-linux"
flake     := "."
host      := "bloom-x86_64"
output    := "result"
ovmf      := "/usr/share/edk2/ovmf/OVMF_CODE.fd"
ovmf_vars := "/usr/share/edk2/ovmf/OVMF_VARS.fd"

# Build Bloom TypeScript app derivation only
build:
    nix build {{ flake }}#bloom-app

# Generate qcow2 disk image
qcow2:
    nix build {{ flake }}#qcow2

# Generate raw disk image (dd to target disk)
raw:
    nix build {{ flake }}#raw

# Generate minimal USB installer ISO (offline bloom-install workflow)
iso:
    nix build {{ flake }}#iso
    
    @echo ""
    @echo "USB installer ISO built: result/iso/"
    @echo ""
    @echo "To flash to USB:"
    @echo "  sudo dd if=result/iso/*.iso of=/dev/sdX bs=4M status=progress conv=fsync"
    @echo ""
    @echo "To install on the target machine:"
    @echo "  1. Boot from the USB stick"
    @echo "  2. Log in as nixos (no password)"
    @echo "  3. Run: sudo bloom-install"
    @echo ""
    @echo "To test the USB workflow in QEMU:"
    @echo "  just test-iso    (opens GUI window)"

# Apply current flake config to the running system (local dev iteration)
switch:
    sudo nixos-rebuild switch --flake {{ flake }}#{{ host }}

# Apply config from the remote GitHub flake (mirrors what bloom-update does on device)
update:
    sudo nixos-rebuild switch --flake github:alexradunet/piBloom#{{ host }}

# Roll back to the previous NixOS generation
rollback:
    sudo nixos-rebuild switch --rollback

# Build qcow2 and run VM (fresh build from current codebase)
vm: qcow2
    core/scripts/run-qemu.sh --mode headless

# Run VM with GUI display
vm-gui: qcow2
    core/scripts/run-qemu.sh --mode gui

# Run VM with existing qcow2 (no rebuild)
vm-run:
    core/scripts/run-qemu.sh --mode headless --skip-setup

# Test the USB installer ISO in QEMU (opens GUI window)
test-iso:
    #!/usr/bin/env bash
    set -euo pipefail
    disk="/tmp/bloom-test-disk-installer.qcow2"
    vars="/tmp/bloom-ovmf-vars-installer.fd"
    
    # Find the actual ISO file
    ISO=$(find -L {{ output }} -name "*.iso" -type f 2>/dev/null | head -1)
    if [ -z "$ISO" ]; then
        echo "Error: No ISO found in {{ output }}/"
        echo "Run 'just iso' first to build the USB installer."
        exit 1
    fi
    
    echo "Found ISO: $ISO"
    rm -f "$disk" "$vars"
    qemu-img create -f qcow2 "$disk" 40G
    cp "{{ ovmf_vars }}" "$vars"
    
    echo ""
    echo "Starting USB installer ISO test..."
    echo "  - ISO: $ISO"
    echo "  - Disk: $disk (40GB)"
    echo "  - RAM: 6GB"
    echo ""
    echo "A window will open. At the boot menu, select the NixOS Installer option."
    echo "Once booted, log in as 'nixos' (no password), then run: sudo bloom-install"
    echo "Close the window or press Ctrl+Alt+2 then type 'quit' to exit."
    echo ""
    
    qemu-system-x86_64 \
        -machine q35 \
        -cpu host \
        -enable-kvm \
        -m 6144 \
        -smp 2 \
        -vga std \
        -display gtk,grab-on-hover=on \
        -drive if=pflash,format=raw,readonly=on,file={{ ovmf }} \
        -drive if=pflash,format=raw,file="$vars" \
        -drive file="$disk",format=qcow2,if=virtio \
        -cdrom "$ISO" \
        -netdev user,id=net0,hostfwd=tcp::2222-:22,hostfwd=tcp::5900-:5900 \
        -device virtio-net-pci,netdev=net0

# Run VM in background daemon mode (detached, no terminal attached)
# Use this when you want to run the VM and still use your shell
# Then connect with: just vm-ssh
vm-daemon: qcow2
    core/scripts/run-qemu.sh --mode daemon

# SSH into the running VM
vm-ssh:
    #!/usr/bin/env bash
    if ! pgrep -f "[q]emu-system-x86_64.*bloom-vm-disk" > /dev/null; then
        echo "No VM running. Start with: just vm-daemon"
        exit 1
    fi
    echo "Connecting to VM..."
    ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p 2222 pi@localhost

# Show VM log (for vm-daemon)
vm-logs:
    tail -f /tmp/bloom-vm.log

# Stop the running VM (graceful if possible, otherwise kill)
vm-stop:
    #!/usr/bin/env bash
    pid=$(pgrep -f "[q]emu-system-x86_64.*bloom-vm-disk" || true)
    if [ -z "$pid" ]; then
        echo "No VM running"
        exit 0
    fi
    echo "Stopping VM (PID: $pid)..."
    kill "$pid" 2>/dev/null || true
    sleep 2
    if kill -0 "$pid" 2>/dev/null; then
        echo "Force killing VM..."
        kill -9 "$pid" 2>/dev/null || true
    fi
    echo "VM stopped"

# Kill the running QEMU VM (legacy alias)
vm-kill: vm-stop

# Remove build results and VM disk
clean:
    rm -f result result-*
    rm -f /tmp/bloom-vm-disk.qcow2 /tmp/bloom-ovmf-vars.fd

# Install host dependencies (Fedora build host; NixOS devs use nix develop)
deps:
    sudo dnf install -y just qemu-system-x86 edk2-ovmf

# Fast config check: build the installer-generated NixOS closure locally.
# Catches locale errors, bad module references, and evaluation failures
# without building an ISO or running QEMU (~10-30 min depending on cache).
check-config:
    nix build {{ flake }}#checks.{{ system }}.bloom-config --no-link

# Full VM boot test: boots the installed system in a NixOS test VM.
# Slower than check-config but verifies runtime behaviour (services, users).
# Requires KVM. Takes 20-40 min on first run.
check-boot:
    nix build {{ flake }}#checks.{{ system }}.bloom-boot --no-link

# Lint Nix files
lint:
    nix flake check
    statix check .

# Format Nix files
# Note: ** glob requires globstar in bash (shopt -s globstar). nixfmt receives
# the expanded paths from the shell; if your shell doesn't expand **, list paths
# explicitly or use: find core/os -name '*.nix' | xargs nixfmt; nixfmt flake.nix
fmt:
    nixfmt core/os/**/*.nix flake.nix
