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

# Generate installer ISO
iso:
    nix build {{ flake }}#iso

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
    #!/usr/bin/env bash
    set -euo pipefail
    disk="/tmp/bloom-vm-disk.qcow2"
    vars="/tmp/bloom-ovmf-vars.fd"
    # Always use fresh OVMF vars to avoid stale boot entries
    rm -f "$vars"
    # Find the actual qcow2 file in the result directory (follow symlinks)
    qcow2_src=$(find -L {{ output }} -name "*.qcow2" -type f | head -1)
    if [ -z "$qcow2_src" ]; then
        echo "Error: No qcow2 found in {{ output }}"
        exit 1
    fi
    echo "Found qcow2: $qcow2_src"
    # Nix store images are read-only; copy to /tmp so QEMU can write
    echo "Copying disk image to $disk..."
    cp -f "$qcow2_src" "$disk"
    chmod 644 "$disk"
    cp "{{ ovmf_vars }}" "$vars"
    echo "Starting VM... Press Ctrl+A X to exit"
    qemu-system-x86_64 \
        -machine q35 \
        -cpu host \
        -enable-kvm \
        -m 4096 \
        -smp 2 \
        -boot order=c,menu=on \
        -drive if=pflash,format=raw,readonly=on,file={{ ovmf }} \
        -drive if=pflash,format=raw,file="$vars" \
        -drive file="$disk",format=qcow2,if=virtio,cache=writeback \
        -netdev user,id=net0,hostfwd=tcp::2222-:22,hostfwd=tcp::5000-:5000,hostfwd=tcp::8080-:8080,hostfwd=tcp::8081-:8081,hostfwd=tcp::8888-:80 \
        -device virtio-net-pci,netdev=net0 \
        -virtfs local,path="$HOME/.bloom",mount_tag=host-bloom,security_model=none,readonly=on \
        -nographic \
        -serial mon:stdio
    echo ""
    echo "Hint: Use 'just vm-daemon' to run VM in background, then 'just vm-ssh' to connect"

# Run VM with GUI display and debug output
vm-gui: qcow2
    #!/usr/bin/env bash
    set -euo pipefail
    disk="/tmp/bloom-vm-disk.qcow2"
    vars="/tmp/bloom-ovmf-vars.fd"
    # Always use fresh OVMF vars
    rm -f "$vars"
    # Find the actual qcow2 file in the result directory (follow symlinks)
    qcow2_src=$(find -L {{ output }} -name "*.qcow2" -type f | head -1)
    if [ -z "$qcow2_src" ]; then
        echo "Error: No qcow2 found in {{ output }}"
        exit 1
    fi
    echo "Found qcow2: $qcow2_src"
    echo "Copying disk image to $disk..."
    cp -f "$qcow2_src" "$disk"
    chmod 644 "$disk"
    cp "{{ ovmf_vars }}" "$vars"
    echo "Starting VM with GUI... Close window to exit"
    qemu-system-x86_64 \
        -machine q35 \
        -cpu host \
        -enable-kvm \
        -m 4096 \
        -smp 2 \
        -boot order=c,menu=on \
        -drive if=pflash,format=raw,readonly=on,file={{ ovmf }} \
        -drive if=pflash,format=raw,file="$vars" \
        -drive file="$disk",format=qcow2,if=virtio,cache=writeback \
        -netdev user,id=net0,hostfwd=tcp::2222-:22,hostfwd=tcp::5000-:5000,hostfwd=tcp::8080-:8080,hostfwd=tcp::8081-:8081 \
        -device virtio-net-pci,netdev=net0 \
        -virtfs local,path="$HOME/.bloom",mount_tag=host-bloom,security_model=none,readonly=on \
        -vga virtio \
        -display gtk

# Run VM with existing qcow2 (no rebuild)
vm-run:
    #!/usr/bin/env bash
    set -euo pipefail
    disk="/tmp/bloom-vm-disk.qcow2"
    vars="/tmp/bloom-ovmf-vars.fd"
    if [ ! -f "$disk" ]; then
        echo "Error: No VM disk found at $disk. Run 'just vm' first."
        exit 1
    fi
    cp "{{ ovmf_vars }}" "$vars"
    echo "Starting VM... Press Ctrl+A X to exit"
    qemu-system-x86_64 \
        -machine q35 \
        -cpu host \
        -enable-kvm \
        -m 4096 \
        -smp 2 \
        -drive if=pflash,format=raw,readonly=on,file={{ ovmf }} \
        -drive if=pflash,format=raw,file="$vars" \
        -drive file="$disk",format=qcow2,if=virtio \
        -netdev user,id=net0,hostfwd=tcp::2222-:22,hostfwd=tcp::5000-:5000,hostfwd=tcp::8080-:8080,hostfwd=tcp::8081-:8081,hostfwd=tcp::8888-:80 \
        -device virtio-net-pci,netdev=net0 \
        -virtfs local,path="$HOME/.bloom",mount_tag=host-bloom,security_model=none,readonly=on \
        -nographic \
        -serial mon:stdio

# Test ISO installation in QEMU (creates temporary disk, boots ISO installer)
test-iso:
    #!/usr/bin/env bash
    set -euo pipefail
    disk="/tmp/bloom-test-disk.qcow2"
    vars="/tmp/bloom-ovmf-vars.fd"
    if [ ! -f "{{ output }}/iso/nixos.iso" ] && [ ! -f "{{ output }}/iso.iso" ]; then
        echo "Error: No ISO found. Run 'just iso' first."
        exit 1
    fi
    ISO=$(find {{ output }} -name "*.iso" | head -1)
    rm -f "$disk" "$vars"
    qemu-img create -f qcow2 "$disk" 40G
    cp "{{ ovmf_vars }}" "$vars"
    echo "Starting ISO installation test... Press Ctrl+A X to exit"
    qemu-system-x86_64 \
        -machine q35 \
        -cpu host \
        -enable-kvm \
        -m 8G \
        -smp 2 \
        -drive if=pflash,format=raw,readonly=on,file={{ ovmf }} \
        -drive if=pflash,format=raw,file="$vars" \
        -drive file="$disk",format=qcow2,if=virtio \
        -cdrom "$ISO" \
        -netdev user,id=net0,hostfwd=tcp::2222-:22 \
        -device virtio-net-pci,netdev=net0 \
        -nographic \
        -serial mon:stdio

# Run VM in background daemon mode (detached, no terminal attached)
# Use this when you want to run the VM and still use your shell
# Then connect with: just vm-ssh
vm-daemon: qcow2
    #!/usr/bin/env bash
    set -euo pipefail
    disk="/tmp/bloom-vm-disk.qcow2"
    vars="/tmp/bloom-ovmf-vars.fd"
    rm -f "$vars"
    qcow2_src=$(find -L {{ output }} -name "*.qcow2" -type f | head -1)
    if [ -z "$qcow2_src" ]; then
        echo "Error: No qcow2 found in {{ output }}"
        exit 1
    fi
    echo "Found qcow2: $qcow2_src"
    echo "Copying disk image to $disk..."
    cp -f "$qcow2_src" "$disk"
    chmod 644 "$disk"
    cp "{{ ovmf_vars }}" "$vars"
    
    # Check if VM is already running
    if pgrep -f "[q]emu-system-x86_64.*bloom-vm-disk" > /dev/null; then
        echo "VM already running. Use 'just vm-ssh' to connect or 'just vm-stop' to stop."
        exit 1
    fi
    
    echo "Starting VM in background..."
    echo "  - Log file: /tmp/bloom-vm.log"
    echo "  - Connect:  just vm-ssh"
    echo "  - Stop:     just vm-stop"
    
    nohup qemu-system-x86_64 \
        -machine q35 \
        -cpu host \
        -enable-kvm \
        -m 4096 \
        -smp 2 \
        -boot order=c,menu=on \
        -drive if=pflash,format=raw,readonly=on,file={{ ovmf }} \
        -drive if=pflash,format=raw,file="$vars" \
        -drive file="$disk",format=qcow2,if=virtio,cache=writeback \
        -netdev user,id=net0,hostfwd=tcp::2222-:22,hostfwd=tcp::5000-:5000,hostfwd=tcp::8080-:8080,hostfwd=tcp::8081-:8081,hostfwd=tcp::8888-:80 \
        -device virtio-net-pci,netdev=net0 \
        -virtfs local,path="$HOME/.bloom",mount_tag=host-bloom,security_model=none,readonly=on \
        -nographic \
        -serial file:/tmp/bloom-vm.log \
        > /dev/null 2>&1 &
    
    echo "Waiting for VM to boot..."
    for i in {1..30}; do
        if nc -z localhost 2222 2>/dev/null; then
            echo "VM is ready! SSH available on port 2222"
            exit 0
        fi
        sleep 1
    done
    echo "VM starting... try 'just vm-ssh' in a few seconds"

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
