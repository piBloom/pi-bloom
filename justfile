# NixPI — build, test, and develop

system    := "x86_64-linux"
flake     := "."
host      := "desktop"
vm_host   := "desktop-vm"
output    := "result"
ovmf      := "/usr/share/edk2/ovmf/OVMF_CODE.fd"
ovmf_vars := "/usr/share/edk2/ovmf/OVMF_VARS.fd"
nix_opts  := "--option substituters https://cache.nixos.org/"
nix_vm_lane_opts := "--option substituters https://cache.nixos.org/ --max-jobs 1"

# Build NixPI TypeScript app derivation only
build:
    nix build {{ flake }}#app

# Apply current flake config to the running system (local dev iteration)
switch:
    sudo nixos-rebuild switch --flake {{ flake }}#{{ host }}

# Apply the installed NixPI checkout
update:
    sudo nixos-rebuild switch --flake ~/nixpi

# Roll back to the previous NixOS generation
rollback:
    sudo nixos-rebuild switch --rollback

# Build qcow2 VM image for testing (uses qemu module, not disk-image.nix)
qcow2:
    nix build {{ flake }}#nixosConfigurations.{{ vm_host }}.config.system.build.vm

# Build the minimal NixPI installer ISO
iso:
    nix build {{ flake }}#installerIso

# Boot the minimal installer ISO in QEMU for full install-flow testing.
# This opens the standard QEMU graphical window.
# Requires a host bridge so the VM behaves like a real network peer.
# The launcher auto-detects a usable bridge and fails clearly if none exists.
# Override with:
#   NIXPI_INSTALL_VM_DISK_PATH=$HOME/custom.qcow2
#   NIXPI_INSTALL_VM_DISK_SIZE=32G
#   NIXPI_INSTALL_VM_MEMORY_MB=8192
#   NIXPI_INSTALL_VM_CPUS=4
vm-install-iso: iso
    NIXPI_INSTALL_VM_OVMF_CODE={{ ovmf }} NIXPI_INSTALL_VM_OVMF_VARS_TEMPLATE={{ ovmf_vars }} bash tools/run-installer-iso.sh

# Run VM (fresh build from current codebase)
vm: qcow2
    tools/run-qemu.sh --mode gui

# Run VM with existing qcow2 (no rebuild)
vm-run:
    tools/run-qemu.sh --mode gui --skip-setup

# Run VM in the terminal over the serial console
vm-headless: qcow2
    tools/run-qemu.sh --mode headless

# Run VM in background daemon mode (detached, no terminal attached)
# Use this when you want to run the VM and still use your shell
# Then connect with: just vm-ssh
vm-daemon: qcow2
    tools/run-qemu.sh --mode daemon

# SSH into the running VM
vm-ssh:
    #!/usr/bin/env bash
    if ! pgrep -f "[q]emu-system-x86_64.*nixpi-vm-disk" > /dev/null; then
        echo "No VM running. Start with: just vm-daemon"
        exit 1
    fi
    echo "Connecting to VM..."
    ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p 2222 pi@localhost

# Show VM log (for vm-daemon)
vm-logs:
    tail -f /tmp/nixpi-vm.log

# Stop the running VM (graceful if possible, otherwise kill)
vm-stop:
    #!/usr/bin/env bash
    pid=$(pgrep -f "[q]emu-system-x86_64.*nixpi-vm-disk" || true)
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
    rm -f /tmp/nixpi-vm-disk.qcow2 /tmp/nixpi-ovmf-vars.fd

# Install host dependencies (Fedora build host; NixOS devs use nix develop)
deps:
    sudo dnf install -y just qemu-system-x86 edk2-ovmf

# Fast config check: build the NixOS closure locally.
# Catches locale errors, bad module references, and evaluation failures
check-config:
    nix {{ nix_opts }} build {{ flake }}#checks.{{ system }}.config --no-link

# Fast installer helper regression tests without booting the ISO.
check-installer:
    nix {{ nix_opts }} build {{ flake }}#checks.{{ system }}.installer-backend --no-link

# Fast generated-config eval: forces the shared installer module to
# evaluate as a NixOS module before the full VM smoke path.
check-installer-generated-config:
    nix {{ nix_opts }} build {{ flake }}#checks.{{ system }}.installer-generated-config --no-link

# Live minimal installer smoke test. This is intentionally separate from the
# PR smoke lane until runtime and stability are proven.
check-installer-smoke:
    nix {{ nix_vm_lane_opts }} build {{ flake }}#checks.{{ system }}.nixpi-installer-smoke --no-link -L

# Full VM boot test: boots the installed system in a NixOS test VM.
# Slower than check-config but verifies runtime behaviour (services, users).
# Requires KVM. Takes 20-40 min on first run.
check-boot:
    nix {{ nix_opts }} build {{ flake }}#checks.{{ system }}.boot --no-link

# PR-oriented NixOS VM smoke lane.
check-nixos-smoke:
    nix {{ nix_vm_lane_opts }} build {{ flake }}#checks.{{ system }}.nixos-smoke --no-link -L

# Host-driven desktop interaction lane using the desktop-vm runner and an SSH probe.
check-desktop-interaction:
    bash tools/check-desktop-interaction.sh

# Comprehensive NixOS VM lane.
check-nixos-full:
    nix {{ nix_vm_lane_opts }} build {{ flake }}#checks.{{ system }}.nixos-full --no-link -L

# Long-running install/lockdown/broker lane.
check-nixos-destructive:
    nix {{ nix_vm_lane_opts }} build {{ flake }}#checks.{{ system }}.nixos-destructive --no-link -L

# Lint Nix files
lint:
    nix flake check --no-build
    statix check .

# Format Nix files
fmt:
    nix fmt
