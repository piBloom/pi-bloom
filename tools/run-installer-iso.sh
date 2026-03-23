#!/usr/bin/env bash
set -euo pipefail

disk="${NIXPI_INSTALL_VM_DISK_PATH:-$HOME/nixpi-install-vm.qcow2}"
disk_size="${NIXPI_INSTALL_VM_DISK_SIZE:-32G}"
memory_mb="${NIXPI_INSTALL_VM_MEMORY_MB:-8192}"
vm_cpus="${NIXPI_INSTALL_VM_CPUS:-4}"
ssh_port="${NIXPI_INSTALL_VM_SSH_PORT:-2222}"
home_port="${NIXPI_INSTALL_VM_HOME_PORT:-18080}"
element_port="${NIXPI_INSTALL_VM_ELEMENT_PORT:-18081}"
matrix_port="${NIXPI_INSTALL_VM_MATRIX_PORT:-16167}"
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

echo "Network mode: user NAT"
echo "SSH forward: localhost:$ssh_port -> guest:22"
echo "Home forward: http://localhost:$home_port -> guest:80"
echo "Element forward: http://localhost:$element_port -> guest:8081"
echo "Matrix forward: http://localhost:$matrix_port -> guest:6167"
echo "Note: outbound networking and in-guest NetBird enrollment should work in this mode."
echo "Note: use the localhost forwards above for host-side access to the guest."
echo "Note: the guest NetBird mesh IP is not expected to behave like a real inbound-reachable peer from the host or LAN in this VM mode."

exec qemu-system-x86_64 \
    -enable-kvm \
    -m "$memory_mb" \
    -smp "$vm_cpus" \
    -drive "if=pflash,format=raw,readonly=on,file=$ovmf_code" \
    -drive "if=pflash,format=raw,file=$ovmf_vars" \
    -drive "file=$disk,format=qcow2,if=virtio" \
    -cdrom "$iso_path" \
    -boot "order=dc,once=d" \
    -nic "user,model=virtio-net-pci,hostfwd=tcp::$ssh_port-:22,hostfwd=tcp::$home_port-:80,hostfwd=tcp::$element_port-:8081,hostfwd=tcp::$matrix_port-:6167"
