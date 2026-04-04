#!/usr/bin/env bash
# run-qemu.sh — VM launcher. Runs the NixOS VM in background daemon mode.
# Usage: run-qemu.sh
set -euo pipefail

DISK="${NIXPI_VM_DISK_PATH:-/tmp/nixpi-vm-disk.qcow2}"
OUTPUT="${NIXPI_VM_OUTPUT:-result}"
LOG_FILE="${NIXPI_VM_LOG_PATH:-/tmp/nixpi-vm.log}"
DISK_SIZE="${NIXPI_VM_DISK_SIZE:-80G}"
MEMORY_MB="${NIXPI_VM_MEMORY_MB:-16384}"
VM_CPUS="${NIXPI_VM_CPUS:-4}"
MIN_DISK_BYTES=$((16 * 1024 * 1024 * 1024))
HOST_REPO_PATH="${NIXPI_VM_HOST_REPO_PATH:-$PWD}"
HOST_NIXPI_PATH="${NIXPI_VM_HOST_STATE_PATH:-$HOME/.nixpi}"
PREFILL_SOURCE="${NIXPI_VM_PREFILL_SOURCE:-core/scripts/prefill.env}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEV_KEY_PATH="${NIXPI_VM_DEV_KEY_PATH:-${SCRIPT_DIR}/dev-key}"
VM_UNIT="${NIXPI_VM_UNIT:-nixpi-vm}"

resolve_runner() {
    local preferred="${OUTPUT}/bin/run-nixos-vm"
    if [[ -x "$preferred" ]]; then
        readlink -f "$preferred"
        return 0
    fi

    local candidates=("${OUTPUT}"/bin/run-*-vm)
    if [[ ${#candidates[@]} -eq 1 && -x "${candidates[0]}" ]]; then
        readlink -f "${candidates[0]}"
        return 0
    fi

    return 1
}

host_port_busy() {
    local port="$1"
    ss -ltn "( sport = :${port} )" 2>/dev/null | tail -n +2 | grep -q .
}

ssh_ready() {
    local key_path="$1"
    ssh -i "$key_path" \
        -o BatchMode=yes \
        -o ConnectTimeout=2 \
        -o StrictHostKeyChecking=no \
        -o UserKnownHostsFile=/dev/null \
        -p 2222 pi@localhost true >/dev/null 2>&1
}

create_empty_filesystem_image() {
    local name="$1"
    local size="$2"
    local temp
    temp="$(mktemp)"
    qemu-img create -f raw "$temp" "$size" >/dev/null
    mkfs.ext4 -L nixos "$temp" >/dev/null
    qemu-img convert -f raw -O qcow2 "$temp" "$name"
    rm -f "$temp"
}

ensure_vm_disk() {
    local recreate=0
    if [[ ! -f "$DISK" ]]; then
        recreate=1
    else
        local virtual_size
        virtual_size="$(qemu-img info --output=json "$DISK" 2>/dev/null | sed -n 's/.*"virtual-size":[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -n1)"
        if [[ -z "$virtual_size" || "$virtual_size" -lt "$MIN_DISK_BYTES" ]]; then
            echo "Recreating stale VM disk at ${DISK} (detected size below 16 GiB)..."
            rm -f "$DISK"
            recreate=1
        fi
    fi

    if [[ "$recreate" -eq 1 ]]; then
        echo "Creating VM disk image at ${DISK} (${DISK_SIZE})..."
        create_empty_filesystem_image "$DISK" "$DISK_SIZE"
    fi
}

if ! RUNNER="$(resolve_runner)"; then
    echo "Error: no VM runner found under ${OUTPUT}/bin. Run 'just qcow2' first." >&2
    exit 1
fi

ensure_vm_disk

if [[ -f "$PREFILL_SOURCE" ]]; then
    mkdir -p "$HOST_NIXPI_PATH"
    cp "$PREFILL_SOURCE" "$HOST_NIXPI_PATH/prefill.env"
    echo "Staged ${PREFILL_SOURCE} -> ${HOST_NIXPI_PATH}/prefill.env"
fi

export NIX_DISK_IMAGE="$DISK"
mkdir -p "$HOST_NIXPI_PATH"
export QEMU_OPTS="-m ${MEMORY_MB} -smp ${VM_CPUS} -nographic \
  -virtfs local,path=${HOST_REPO_PATH},security_model=none,readonly=on,mount_tag=host-repo \
  -virtfs local,path=${HOST_NIXPI_PATH},security_model=none,readonly=on,mount_tag=host-nixpi"

net_opts=()
for spec in "2222:22:required"; do
    IFS=":" read -r host_port guest_port policy <<<"${spec}"
    if host_port_busy "${host_port}"; then
        if [[ "${policy}" == "required" ]]; then
            echo "Error: required host port ${host_port} is already in use." >&2
            exit 1
        fi
        continue
    fi
    net_opts+=("hostfwd=tcp::${host_port}-:${guest_port}")
done

export QEMU_NET_OPTS
QEMU_NET_OPTS="$(IFS=,; echo "${net_opts[*]}")"

if systemctl --user --quiet is-active "${VM_UNIT}.service" || pgrep -f "[r]un-nixos-vm|[q]emu-system-x86_64.*${DISK}" >/dev/null; then
    echo "VM already running. Use 'just vm-ssh' to connect or 'just vm-stop' to stop."
    exit 1
fi

echo "Starting VM in background..."
echo "  - Log file: ${LOG_FILE}"
echo "  - Connect:  just vm-ssh"
echo "  - Stop:     just vm-stop"
systemd-run --user --unit "${VM_UNIT}" --collect \
    --setenv=NIX_DISK_IMAGE="${NIX_DISK_IMAGE}" \
    --setenv=QEMU_OPTS="${QEMU_OPTS}" \
    --setenv=QEMU_NET_OPTS="${QEMU_NET_OPTS}" \
    /usr/bin/bash -lc 'exec "$1" </dev/null >"$2" 2>&1' bash "$RUNNER" "${LOG_FILE}" >/dev/null

echo "Waiting for VM to boot..."
temp_key=""
if [[ -f "$DEV_KEY_PATH" ]]; then
    temp_key="$(mktemp)"
    trap 'rm -f "$temp_key"' EXIT
    install -m 600 "$DEV_KEY_PATH" "$temp_key"
fi

for i in {1..60}; do
    if [[ -n "$temp_key" ]]; then
        if ssh_ready "$temp_key"; then
            echo "VM is ready! SSH available on port 2222"
            exit 0
        fi
    elif nc -z localhost 2222 2>/dev/null; then
        echo "VM is ready! SSH available on port 2222"
        exit 0
    fi
    sleep 1
done

echo "VM starting... try 'just vm-ssh' in a few seconds"
