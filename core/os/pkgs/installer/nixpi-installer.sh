#!/usr/bin/env bash
set -euo pipefail

HELPER_BIN="@helperBin@"

ROOT_MOUNT="/mnt"
HOSTNAME_VALUE=""
PRIMARY_USER_VALUE=""
PRIMARY_PASSWORD_VALUE=""
TARGET_DISK=""
FORCE_YES=0
SYSTEM_CLOSURE=""
LAYOUT_MODE=""
SWAP_SIZE=""
INSTALLER_LOG="/tmp/nixpi-installer.log"
LOG_REDIRECTED=0

usage() {
  cat <<'EOF'
Usage: nixpi-installer [--disk /dev/sdX] [--hostname NAME] [--primary-user USER] [--password VALUE] [--layout no-swap|swap] [--swap-size 8GiB] [--yes] [--system PATH]

Performs a destructive UEFI install with:
- EFI system partition: 1 MiB - 1 GiB
- ext4 root partition: 1 GiB - end of disk or swap

The installer creates a minimal bootable NixPI base. The first-boot setup
wizard handles WiFi, internet validation, and promotion into the full
appliance profile.
EOF
}

require_tty() {
  if [[ ! -t 0 || ! -t 1 ]]; then
    echo "Interactive mode requires a TTY." >&2
    exit 1
  fi
}

ensure_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    echo "Run nixpi-installer as root." >&2
    exit 1
  fi
}

log_step() {
  printf '\n==> %s\n' "$*"
}

enable_logging() {
  if [[ "$LOG_REDIRECTED" -eq 1 ]]; then
    return
  fi

  : >"$INSTALLER_LOG"
  exec > >(tee -a "$INSTALLER_LOG") 2>&1
  LOG_REDIRECTED=1
  log_step "Writing installer log to $INSTALLER_LOG"
}

list_writable_disks() {
  lsblk -dnpr -o PATH,SIZE,TYPE,RO | awk '$3 == "disk" && $4 == 0 { print $1 "\t" $2 }'
}

disk_model() {
  local disk="$1"
  lsblk -dnro MODEL "$disk" 2>/dev/null | sed 's/^[[:space:]]*//; s/[[:space:]]*$//'
}

choose_disk() {
  if [[ -n "$TARGET_DISK" ]]; then
    return
  fi

  mapfile -t disks < <(list_writable_disks)
  if [[ ${#disks[@]} -eq 0 ]]; then
    echo "No writable disks found." >&2
    exit 1
  fi

  if [[ ${#disks[@]} -eq 1 ]]; then
    TARGET_DISK="${disks[0]%%$'\t'*}"
    return
  fi

  require_tty

  local entry name size model description
  local index=1
  for entry in "${disks[@]}"; do
    IFS=$'\t' read -r name size <<<"$entry"
    model="$(disk_model "$name")"
    description="$size"
    if [[ -n "$model" ]]; then
      description="$description  $model"
    fi
    printf '  %d) %s  %s\n' "$index" "$name" "$description"
    index=$((index + 1))
  done

  while true; do
    read -rp "Choose the target disk [1-${#disks[@]}]: " disk_choice
    if [[ "$disk_choice" =~ ^[0-9]+$ ]] && (( disk_choice >= 1 && disk_choice <= ${#disks[@]} )); then
      TARGET_DISK="${disks[disk_choice-1]%%$'\t'*}"
      return
    fi
    echo "Invalid selection." >&2
  done
}

prompt_inputs() {
  if [[ -z "$HOSTNAME_VALUE" ]]; then
    require_tty
    while true; do
      read -rp "Hostname [nixpi]: " HOSTNAME_VALUE
      HOSTNAME_VALUE="${HOSTNAME_VALUE:-nixpi}"
      if [[ -n "$HOSTNAME_VALUE" ]]; then
        break
      fi
      printf '%s\n' "Hostname cannot be empty." >&2
    done
  fi

  if [[ -z "$PRIMARY_USER_VALUE" ]]; then
    require_tty
    while true; do
      read -rp "Primary user [nixpi]: " PRIMARY_USER_VALUE
      PRIMARY_USER_VALUE="${PRIMARY_USER_VALUE:-nixpi}"
      if [[ -n "$PRIMARY_USER_VALUE" ]]; then
        break
      fi
      printf '%s\n' "Primary user cannot be empty." >&2
    done
  fi
}

prompt_password() {
  if [[ -n "$PRIMARY_PASSWORD_VALUE" ]]; then
    return
  fi

  if [[ "$FORCE_YES" -eq 1 ]]; then
    echo "--yes requires --password for the primary user." >&2
    exit 1
  fi

  require_tty

  local password confirm_password
  while true; do
    read -rsp "Primary user password: " password
    echo ""
    if [[ -z "$password" ]]; then
      echo "Password cannot be empty." >&2
      continue
    fi
    read -rsp "Confirm primary user password: " confirm_password
    echo ""
    if [[ "$password" != "$confirm_password" ]]; then
      echo "Passwords do not match." >&2
      continue
    fi
    PRIMARY_PASSWORD_VALUE="$password"
    return
  done
}

validate_swap_size() {
  local size="$1"
  [[ "$size" =~ ^[1-9][0-9]*(MiB|GiB|MB|GB)$ ]]
}

choose_layout() {
  if [[ -n "$LAYOUT_MODE" ]]; then
    return
  fi

  if [[ "$FORCE_YES" -eq 1 ]]; then
    LAYOUT_MODE="no-swap"
    return
  fi

  require_tty

  local choice=""

  echo "Choose the disk layout:"
  echo "  1) EFI + ext4 root"
  echo "  2) EFI + ext4 root + 8GiB swap"
  echo "  3) EFI + ext4 root + custom swap"

  while true; do
    read -rp "Select option [1/2/3]: " choice
    case "$choice" in
      1)
        choice="no-swap"
        break
        ;;
      2)
        choice="swap:8GiB"
        break
        ;;
      3)
        choice="swap:custom"
        break
        ;;
      *)
        echo "Invalid option." >&2
        ;;
    esac
  done

  case "$choice" in
    no-swap)
      LAYOUT_MODE="no-swap"
      ;;
    swap:8GiB)
      LAYOUT_MODE="swap"
      SWAP_SIZE="8GiB"
      ;;
    swap:custom)
      LAYOUT_MODE="swap"
      while true; do
        read -rp "Swap size [8GiB]: " SWAP_SIZE
        SWAP_SIZE="${SWAP_SIZE:-8GiB}"
        if validate_swap_size "$SWAP_SIZE"; then
          break
        fi
        printf '%s\n' "Swap size must look like 8GiB, 4096MiB, 8GB, or 4096MB." >&2
      done
      ;;
    *)
      echo "Unknown layout selection: $choice" >&2
      exit 1
      ;;
  esac
}

normalize_layout_inputs() {
  if [[ -z "$LAYOUT_MODE" ]]; then
    LAYOUT_MODE="no-swap"
  fi

  case "$LAYOUT_MODE" in
    no-swap)
      SWAP_SIZE=""
      ;;
    swap)
      if [[ -z "$SWAP_SIZE" ]]; then
        SWAP_SIZE="8GiB"
      fi
      if ! validate_swap_size "$SWAP_SIZE"; then
        echo "Invalid --swap-size value: $SWAP_SIZE" >&2
        exit 1
      fi
      ;;
    *)
      echo "Invalid --layout value: $LAYOUT_MODE" >&2
      exit 1
      ;;
  esac
}

confirm_install() {
  if [[ "$FORCE_YES" -eq 1 ]]; then
    return
  fi

  require_tty
  local layout_summary
  if [[ "$LAYOUT_MODE" == "swap" ]]; then
    layout_summary="EFI 1 GiB + ext4 root + swap (${SWAP_SIZE})"
  else
    layout_summary="EFI 1 GiB + ext4 root"
  fi
  printf '%s\n' \
    "Target disk: ${TARGET_DISK}" \
    "Layout: ${layout_summary}" \
    "Hostname: ${HOSTNAME_VALUE}" \
    "Primary user: ${PRIMARY_USER_VALUE}" \
    "Primary user password: [set]" \
    "" \
    "This will erase the selected disk."
  read -rp "Proceed with destructive install? [y/N]: " proceed
  if [[ ! "$proceed" =~ ^[Yy]$ ]]; then
    echo "Install cancelled."
    exit 0
  fi
}

partition_prefix() {
  if [[ "$TARGET_DISK" =~ [0-9]$ ]]; then
    printf "%sp" "$TARGET_DISK"
  else
    printf "%s" "$TARGET_DISK"
  fi
}

run_install_steps() {
  local boot_part="$1"
  local root_part="$2"
  local swap_part="$3"

  echo "=== [2/5] Partitioning ==="
  log_step "Partitioning $TARGET_DISK"
  parted -s "$TARGET_DISK" mklabel gpt
  parted -s "$TARGET_DISK" mkpart ESP fat32 1MiB 1GiB
  parted -s "$TARGET_DISK" set 1 esp on
  if [[ "$LAYOUT_MODE" == "swap" ]]; then
    parted -s -- "$TARGET_DISK" mkpart root ext4 1GiB "-$SWAP_SIZE"
    parted -s -- "$TARGET_DISK" mkpart swap linux-swap "-$SWAP_SIZE" 100%
  else
    parted -s "$TARGET_DISK" mkpart root ext4 1GiB 100%
  fi
  udevadm settle

  log_step "Formatting $boot_part as FAT32"
  mkfs.fat -F 32 -n boot "$boot_part"

  log_step "Formatting $root_part as ext4"
  mkfs.ext4 -F -L nixos "$root_part"

  if [[ "$LAYOUT_MODE" == "swap" ]]; then
    log_step "Creating swap on $swap_part (${SWAP_SIZE})"
    mkswap -L swap "$swap_part"
    swapon "$swap_part"
  fi

  log_step "Mounting target filesystem at $ROOT_MOUNT"
  mount "$root_part" "$ROOT_MOUNT"
  mkdir -p "$ROOT_MOUNT/boot"
  mount -o umask=077 "$boot_part" "$ROOT_MOUNT/boot"

  echo "=== [3/5] Writing boot configuration ==="
  log_step "Generating base NixOS config"
  nixos-generate-config --root "$ROOT_MOUNT"

  log_step "Writing NixPI install artifacts"
  "$HELPER_BIN" \
    --root "$ROOT_MOUNT" \
    --hostname "$HOSTNAME_VALUE" \
    --primary-user "$PRIMARY_USER_VALUE" \
    --password "$PRIMARY_PASSWORD_VALUE" \
    >/tmp/nixpi-installer-artifacts.json
  log_step "Installer artifacts written to /tmp/nixpi-installer-artifacts.json"

  echo "=== [4/5] Installing NixOS (this may take 10-20 minutes) ==="
  if [[ -n "$SYSTEM_CLOSURE" ]]; then
    log_step "Installing prebuilt system closure"
    nixos-install --no-root-passwd --system "$SYSTEM_CLOSURE" --root "$ROOT_MOUNT"
  else
    log_step "Running nixos-install from configuration.nix"
    NIX_CONFIG="experimental-features = nix-command flakes" \
      NIXOS_INSTALL_BOOTLOADER=1 \
      nixos-install --no-root-passwd --root "$ROOT_MOUNT" --no-channel-copy -I "nixos-config=$ROOT_MOUNT/etc/nixos/configuration.nix"
  fi
}

run_install() {
  local prefix boot_part root_part swap_part
  prefix="$(partition_prefix)"
  boot_part="${prefix}1"
  root_part="${prefix}2"
  swap_part="${prefix}3"

  mkdir -p "$ROOT_MOUNT"
  swapoff "$swap_part" 2>/dev/null || true
  umount "$ROOT_MOUNT/boot" 2>/dev/null || true
  umount "$ROOT_MOUNT" 2>/dev/null || true
  enable_logging

  run_install_steps "$boot_part" "$root_part" "$swap_part"
}

main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --disk)
        TARGET_DISK="$2"
        shift 2
        ;;
      --hostname)
        HOSTNAME_VALUE="$2"
        shift 2
        ;;
      --primary-user)
        PRIMARY_USER_VALUE="$2"
        shift 2
        ;;
      --password)
        PRIMARY_PASSWORD_VALUE="$2"
        shift 2
        ;;
      --layout)
        LAYOUT_MODE="$2"
        shift 2
        ;;
      --swap-size)
        SWAP_SIZE="$2"
        shift 2
        ;;
      --yes)
        FORCE_YES=1
        shift
        ;;
      --system)
        SYSTEM_CLOSURE="$2"
        shift 2
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        echo "Unknown argument: $1" >&2
        usage >&2
        exit 1
        ;;
    esac
  done

  ensure_root
  echo "=== [1/5] Disk selection ==="
  choose_disk
  prompt_inputs
  prompt_password
  choose_layout
  normalize_layout_inputs
  confirm_install
  run_install

  echo "=== [5/5] Finalizing ==="
  echo "NixPI install completed. Reboot when ready."
  echo "After reboot, connect to WiFi in the first-boot setup wizard before promoting to the full appliance."
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
