# NixPI — build, test, and develop

system    := "x86_64-linux"
flake     := "."
host      := "desktop"
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
    sudo nixos-rebuild switch --flake /srv/nixpi

# Roll back to the previous NixOS generation
rollback:
    sudo nixos-rebuild switch --rollback

# Build the minimal NixPI installer ISO
iso:
    nix build {{ flake }}#installerIso

# Boot the minimal installer ISO in QEMU for full install-flow testing.
# This opens the standard QEMU graphical window.
# Override with:
#   NIXPI_INSTALL_VM_DISK_PATH=$HOME/custom.qcow2
#   NIXPI_INSTALL_VM_DISK_SIZE=32G
#   NIXPI_INSTALL_VM_MEMORY_MB=8192
#   NIXPI_INSTALL_VM_CPUS=4
#   NIXPI_INSTALL_VM_SSH_PORT=2222
#   NIXPI_INSTALL_PREFILL_PATH=$PWD/prefill.env
vm-install-iso: iso
    NIXPI_INSTALL_VM_OVMF_CODE={{ ovmf }} NIXPI_INSTALL_VM_OVMF_VARS_TEMPLATE={{ ovmf_vars }} bash tools/run-installer-iso.sh

# SSH into the installer VM or freshly installed system
vm-ssh:
    #!/usr/bin/env bash
    ssh_user="${NIXPI_INSTALL_VM_SSH_USER:-human}"
    ssh_port="${NIXPI_INSTALL_VM_SSH_PORT:-2222}"
    disk_path="${NIXPI_INSTALL_VM_DISK_PATH:-$HOME/nixpi-install-vm.qcow2}"
    disk_name="$(basename "$disk_path")"
    if ! pgrep -f "[q]emu-system-x86_64.*${disk_name}" > /dev/null; then
        echo "No installer VM running. Start with: just vm-install-iso"
        exit 1
    fi
    key_file="$(mktemp)"
    trap 'rm -f "$key_file"' EXIT
    install -m 600 tools/dev-key "$key_file"
    echo "Connecting to VM using committed dev key..."
    ssh -i "$key_file" \
        -o StrictHostKeyChecking=no \
        -o UserKnownHostsFile=/dev/null \
        -p "${ssh_port}" "${ssh_user}@localhost"

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
