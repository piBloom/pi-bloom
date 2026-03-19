#!/usr/bin/env bash
# bloom-install.sh — Guided USB installer for Bloom OS.
# Runs from the minimal installer ISO and wraps disko-install with a temporary
# flake that injects machine-specific basics without mutating the repo flake.
set -euo pipefail

OFFLINE_BASE="/etc/bloom/offline"
WORKDIR="/tmp/bloom-install"
TARGET_FLAKE="$WORKDIR/flake.nix"
MACHINE_CONFIG="$WORKDIR/machine-config.nix"

DEFAULT_HOSTNAME="bloom"
DEFAULT_TIMEZONE="UTC"
DEFAULT_LOCALE="en_US.UTF-8"
DEFAULT_KEYBOARD="us"

die() {
    echo "ERROR: $*" >&2
    exit 1
}

require_root() {
    if [[ "$(id -u)" -ne 0 ]]; then
        die "Run this installer as root: sudo bloom-install"
    fi
}

require_offline_sources() {
    local missing=0
    local path
    for path in \
        "$OFFLINE_BASE/nixpkgs" \
        "$OFFLINE_BASE/disko" \
        "$OFFLINE_BASE/bloom"
    do
        if [[ ! -d "$path" ]]; then
            echo "Missing offline source: $path" >&2
            missing=1
        fi
    done
    [[ "$missing" -eq 0 ]] || die "Installer media is missing required offline sources."
}

list_candidate_disks() {
    lsblk -dpno NAME,SIZE,TYPE,MODEL | while read -r name size type model; do
        [[ "$type" == "disk" ]] || continue
        case "$name" in
            /dev/loop*|/dev/zram*|/dev/ram*|/dev/sr*)
                continue
                ;;
        esac
        printf "%s | %s | %s\n" "$name" "$size" "${model:-unknown}"
    done
}

print_candidate_disks() {
    echo "Available target disks:"
    list_candidate_disks | nl -w2 -s'. '
}

disk_has_mounted_partitions() {
    local disk="$1"
    lsblk -nrpo TYPE,MOUNTPOINT "$disk" | awk '$1 == "part" && $2 != "" { found = 1 } END { exit(found ? 0 : 1) }'
}

select_disk() {
    local disks disk_count choice selected
    mapfile -t disks < <(list_candidate_disks)
    disk_count="${#disks[@]}"
    [[ "$disk_count" -gt 0 ]] || die "No installable target disks found."

    print_candidate_disks
    echo ""
    while true; do
        read -rp "Select target disk [1-${disk_count}]: " choice
        [[ "$choice" =~ ^[0-9]+$ ]] || {
            echo "Enter a number."
            continue
        }
        if (( choice < 1 || choice > disk_count )); then
            echo "Choice out of range."
            continue
        fi
        selected="${disks[$((choice - 1))]}"
        TARGET_DISK="${selected%% | *}"
        break
    done

    if disk_has_mounted_partitions "$TARGET_DISK"; then
        die "Refusing to install to $TARGET_DISK because one or more partitions are mounted."
    fi
}

prompt_with_default() {
    local prompt="$1" default="$2" value
    read -rp "$prompt [$default]: " value
    if [[ -z "$value" ]]; then
        printf '%s\n' "$default"
    else
        printf '%s\n' "$value"
    fi
}

validate_hostname() {
    local value="$1"
    [[ "$value" =~ ^[a-zA-Z0-9][a-zA-Z0-9-]*$ ]] || die "Hostname must contain only letters, digits, and hyphens."
}

validate_locale() {
    local value="$1"
    [[ "$value" =~ ^[A-Za-z_]+(\.[A-Za-z0-9-]+)?$ ]] || die "Locale must look like en_US.UTF-8."
}

validate_timezone() {
    local value="$1"
    [[ -f "/etc/zoneinfo/$value" ]] || die "Unknown timezone: $value"
}

validate_keymap() {
    local value="$1"
    local map_path=""
    local search_dirs=()
    
    # Common NixOS keymap locations
    if [[ -d /run/current-system/sw/share/keymaps ]]; then
        search_dirs+=(/run/current-system/sw/share/keymaps)
    fi
    if [[ -d /nix/var/nix/profiles/system/sw/share/keymaps ]]; then
        search_dirs+=(/nix/var/nix/profiles/system/sw/share/keymaps)
    fi
    # kbd package location
    if [[ -d /usr/share/keymaps ]]; then
        search_dirs+=(/usr/share/keymaps)
    fi
    
    # Try to find the keymap
    for dir in "${search_dirs[@]}"; do
        map_path="$(find "$dir" -name "${value}.map.gz" -o -name "${value}.map" 2>/dev/null | head -1 || true)"
        [[ -n "$map_path" ]] && break
    done
    
    if [[ -z "$map_path" ]]; then
        # If we can't validate, warn but don't fail - the install might still work
        # with the default or the user can fix it later
        if [[ ${#search_dirs[@]} -eq 0 ]]; then
            echo "Warning: Cannot find keymap directory to validate '$value'" >&2
            echo "         Using '$value' anyway - you can fix keymap after install." >&2
        else
            echo "Warning: Unknown console keymap: $value" >&2
            echo "         Using '$value' anyway - you can fix keymap after install." >&2
        fi
    fi
}

write_machine_config() {
    mkdir -p "$WORKDIR"
    cat > "$MACHINE_CONFIG" <<EOF
{ ... }: {
  nixpkgs.config.allowUnfree = true;
  networking.hostName = "${HOSTNAME_VALUE}";
  time.timeZone = "${TIMEZONE_VALUE}";
  i18n.defaultLocale = "${LOCALE_VALUE}";
  services.xserver.xkb = {
    layout = "${KEYBOARD_LAYOUT}";
    variant = "";
  };
  console.keyMap = "${KEYBOARD_LAYOUT}";
}
EOF
}

write_wrapper_flake() {
    cat > "$TARGET_FLAKE" <<'EOF'
{
  inputs = {
    nixpkgs.url = "path:/etc/bloom/offline/nixpkgs";
    disko = {
      url = "path:/etc/bloom/offline/disko";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, disko, ... }:
    let
      system = "x86_64-linux";
      bloomSrc = /etc/bloom/offline/bloom;
      pkgs = import nixpkgs { inherit system; };
      piAgent = pkgs.callPackage (bloomSrc + "/core/os/pkgs/pi") {};
      bloomApp = pkgs.callPackage (bloomSrc + "/core/os/pkgs/bloom-app") { inherit piAgent; };
    in {
      nixosConfigurations.bloom = nixpkgs.lib.nixosSystem {
        inherit system;
        specialArgs = { inherit piAgent bloomApp; };
        modules = [
          (bloomSrc + "/core/os/hosts/x86_64.nix")
          disko.nixosModules.disko
          (bloomSrc + "/core/os/hosts/x86_64-disk.nix")
          ./machine-config.nix
        ];
      };
    };
}
EOF
}

confirm_install() {
    echo ""
    echo "Bloom OS will be installed with these settings:"
    echo "  Disk:      $TARGET_DISK"
    echo "  Hostname:  $HOSTNAME_VALUE"
    echo "  Timezone:  $TIMEZONE_VALUE"
    echo "  Locale:    $LOCALE_VALUE"
    echo "  Keyboard:  $KEYBOARD_LAYOUT"
    echo ""
    echo "This will erase all data on $TARGET_DISK."
    read -rp "Type 'ERASE' to continue: " confirmation
    [[ "$confirmation" == "ERASE" ]] || die "Installation aborted."
}

run_install() {
    echo ""
    echo "Partitioning disk with disko..."
    
    # Run disko to partition and mount the disk
    nix --extra-experimental-features "nix-command flakes" run \
        --no-lock-file \
        "$OFFLINE_BASE/disko#disko" -- \
        --mode destroy,format,mount \
        --flake "$WORKDIR#bloom"
    
    echo ""
    echo "Installing NixOS..."
    
    # Install NixOS
    nixos-install \
        --no-channel-copy \
        --root /mnt \
        --flake "$WORKDIR#bloom"
    
    echo ""
    echo "Installation complete!"
}

main() {
    require_root
    require_offline_sources

    echo "Bloom OS USB installer"
    echo ""

    select_disk
    HOSTNAME_VALUE="$(prompt_with_default "Hostname" "$DEFAULT_HOSTNAME")"
    TIMEZONE_VALUE="$(prompt_with_default "Timezone" "$DEFAULT_TIMEZONE")"
    LOCALE_VALUE="$(prompt_with_default "Locale" "$DEFAULT_LOCALE")"
    KEYBOARD_LAYOUT="$(prompt_with_default "Keyboard layout / console keymap" "$DEFAULT_KEYBOARD")"

    validate_hostname "$HOSTNAME_VALUE"
    validate_timezone "$TIMEZONE_VALUE"
    validate_locale "$LOCALE_VALUE"
    validate_keymap "$KEYBOARD_LAYOUT"

    write_machine_config
    write_wrapper_flake
    confirm_install
    run_install

    echo ""
    echo "Installation complete."
    echo "Reboot, remove the USB installer, and finish Bloom setup on first boot."
}

main "$@"
