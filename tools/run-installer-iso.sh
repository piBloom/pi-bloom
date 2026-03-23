#!/usr/bin/env bash
set -euo pipefail

network_mode="${1:-user}"
bridge_name="${2:-}"

disk="${NIXPI_INSTALL_VM_DISK_PATH:-$HOME/nixpi-install-vm.qcow2}"
disk_size="${NIXPI_INSTALL_VM_DISK_SIZE:-32G}"
memory_mb="${NIXPI_INSTALL_VM_MEMORY_MB:-8192}"
vm_cpus="${NIXPI_INSTALL_VM_CPUS:-4}"
ssh_port="${NIXPI_INSTALL_VM_SSH_PORT:-2222}"
ovmf_code="${NIXPI_INSTALL_VM_OVMF_CODE:-/usr/share/edk2/ovmf/OVMF_CODE.fd}"
ovmf_vars_template="${NIXPI_INSTALL_VM_OVMF_VARS_TEMPLATE:-/usr/share/edk2/ovmf/OVMF_VARS.fd}"
ovmf_vars="${NIXPI_INSTALL_VM_OVMF_VARS_PATH:-$HOME/.cache/nixpi-install-ovmf-vars.fd}"
iso_path=""

if [ -f result ] && [[ "$(readlink -f result)" = *.iso ]]; then
    iso_path="$(readlink -f result)"
elif [ -d result/iso ]; then
    iso_path="$(find result/iso -maxdepth 1 -name '*.iso' | head -n1)"
fi

if [ -z "$iso_path" ]; then
    echo "Installer ISO not found under result/iso"
    exit 1
fi

echo "Resetting installer VM state..."
rm -f "$disk"
rm -f "$ovmf_vars"
rm -rf "$HOME/.nixpi"

echo "Creating installer VM disk at $disk ($disk_size)..."
qemu-img create -f qcow2 "$disk" "$disk_size" >/dev/null

mkdir -p "$(dirname "$ovmf_vars")"
cp "$ovmf_vars_template" "$ovmf_vars"

echo "Booting installer ISO: $iso_path"
echo "ISO timestamp: $(stat -c '%y' "$iso_path")"
echo "Disk: $disk"
echo "Console: graphical"

case "$network_mode" in
    user)
        echo "Network mode: user NAT"
        echo "SSH forward: localhost:$ssh_port -> guest:22"
        echo "Note: NetBird and guest service URLs are not directly reachable from the host as a real peer in this mode."
        net_arg="-nic user,model=virtio-net-pci,hostfwd=tcp::$ssh_port-:22"
        ;;
    bridge)
        if [ -z "$bridge_name" ]; then
            echo "Bridge mode requires a bridge name argument."
            echo "Example: NIXPI_INSTALL_VM_BRIDGE=br0 just vm-install-iso-bridge"
            exit 1
        fi
        echo "Network mode: bridge ($bridge_name)"
        echo "Note: this mode depends on local host bridge support and is intended for realistic NetBird validation."
        net_arg="-nic bridge,br=$bridge_name,model=virtio-net-pci"
        ;;
    *)
        echo "Unsupported network mode: $network_mode"
        exit 1
        ;;
esac

exec qemu-system-x86_64 \
    -enable-kvm \
    -m "$memory_mb" \
    -smp "$vm_cpus" \
    -drive "if=pflash,format=raw,readonly=on,file=$ovmf_code" \
    -drive "if=pflash,format=raw,file=$ovmf_vars" \
    -drive "file=$disk,format=qcow2,if=virtio" \
    -cdrom "$iso_path" \
    -boot "order=dc,once=d" \
    "$net_arg"
