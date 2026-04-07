#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

BASE_DISK="${DISK_DIR}/preinstalled-stable.qcow2"
INSTALLER_DISK="${DISK_DIR}/installer-scratch.qcow2"

require_cmd "$(qemu_img_bin)"
create_qcow2 "${BASE_DISK}"

cat <<EOF2
Preinstalled stable disk target prepared at:
  ${BASE_DISK}

Next steps:
  1. Launch the installer path:
     tools/qemu/run-installer.sh
  2. In the guest, install stable NixOS onto:
     ${INSTALLER_DISK}
  3. Shut the guest down after first login validation.
  4. Clone the installed scratch disk into the reusable base image:
     $(qemu_img_bin) convert -f qcow2 -O qcow2 "${INSTALLER_DISK}" "${BASE_DISK}"
  5. Reuse the cloned disk with:
     tools/qemu/run-preinstalled-stable.sh
EOF2
