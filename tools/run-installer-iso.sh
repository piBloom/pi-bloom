#!/usr/bin/env bash
set -euo pipefail

disk="${NIXPI_INSTALL_VM_DISK_PATH:-$HOME/nixpi-install-vm.qcow2}"
disk_size="${NIXPI_INSTALL_VM_DISK_SIZE:-32G}"
memory_mb="${NIXPI_INSTALL_VM_MEMORY_MB:-8192}"
vm_cpus="${NIXPI_INSTALL_VM_CPUS:-4}"
ssh_port="${NIXPI_INSTALL_VM_SSH_PORT:-2222}"
home_port="${NIXPI_INSTALL_VM_HOME_PORT:-18080}"
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

echo "WARNING: This will delete ~/.nixpi (VM state reset). Continue? [y/N]"
if IFS= read -r confirm; then
    :
elif [[ -r /dev/tty ]] && IFS= read -r confirm </dev/tty; then
    :
else
    echo "Aborted."
    echo "Confirmation requires an interactive terminal." >&2
    exit 1
fi
confirm="${confirm//$'\r'/}"
confirm="${confirm#"${confirm%%[![:space:]]*}"}"
confirm="${confirm%"${confirm##*[![:space:]]}"}"
[[ "${confirm,,}" == "y" ]] || { echo "Aborted."; exit 1; }
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
echo "Use the localhost forwards above for host-side access to the guest."

exec qemu-system-x86_64 \
    -enable-kvm \
    -m "$memory_mb" \
    -smp "$vm_cpus" \
    -drive "if=pflash,format=raw,readonly=on,file=$ovmf_code" \
    -drive "if=pflash,format=raw,file=$ovmf_vars" \
    -drive "file=$disk,format=qcow2,if=virtio" \
    -cdrom "$iso_path" \
    -boot "order=dc,once=d" \
    -nic "user,model=virtio-net-pci,hostfwd=tcp::$ssh_port-:22,hostfwd=tcp::$home_port-:80"
