# Bloom OS Pre-Install Audit — Design Spec

**Date:** 2026-03-23
**Target hardware:** Beelink EQ14 (x86_64 UEFI), generically any modern x86_64 PC/laptop
**Scope:** Comprehensive audit covering hardware portability, code quality, resilience, tests, QoL, and documentation

---

## Overview

This audit prepares the Bloom OS codebase for real-hardware installation (minipc, laptop, or any x86_64 UEFI machine) and improves overall quality. The codebase is already clean and well-structured; the changes are targeted rather than sweeping.

---

## Section 1: Hardware Portability

**Problem:** `core/os/hosts/x86_64.nix` hardcodes QEMU virtio disk paths:

```nix
fileSystems."/" = lib.mkDefault { device = "/dev/vda"; fsType = "ext4"; };
fileSystems."/boot" = lib.mkDefault { device = "/dev/vda1"; fsType = "vfat"; };
```

These paths don't exist on real hardware (NVMe: `/dev/nvme0n1`, SATA: `/dev/sda`). This causes a boot failure on physical machines.

**Fix — x86_64.nix:**
Remove both `fileSystems` entries from `x86_64.nix`. Leave no stub or fallback. The file should have no `fileSystems` keys at all.

**How hardware-configuration.nix is wired in:**
The installer (`nixpi-installer.sh`) already runs `nixos-generate-config --root /mnt`, producing `/mnt/etc/nixos/hardware-configuration.nix` with kernel modules and hardware-specific config for the target machine. The installer uses disk labels (`-L nixos`, `-L boot`) not raw device paths, so `nixos-generate-config` should be called with `--no-filesystems` to avoid duplicate filesystem entries — the installer's labelled partitions are the source of truth. The `--no-filesystems` flag is available in NixOS 23.05+; the flake pins nixpkgs to nixos-unstable (well above this), so the ISO will always have it.

The flake template in `firstboot.nix` that writes `/etc/nixos/flake.nix` must import `hardware-configuration.nix` alongside `x86_64.nix`. This is the load-bearing change.

Current generated flake template (pseudocode):
```nix
imports = [ <nixpi>/core/os/hosts/x86_64.nix ];
```

Updated template must be:
```nix
imports = [
  <nixpi>/core/os/hosts/x86_64.nix
  ./hardware-configuration.nix
];
```

**x86_64.nix filesystem entries instead of hardware-configuration.nix:**
Since the installer labels partitions (`LABEL=nixos`, `LABEL=boot`), the host config can use stable label-based references instead of UUIDs or device paths. Add back `fileSystems` using labels — this is portable across any machine and doesn't require `hardware-configuration.nix` for disk mounts:

```nix
fileSystems."/" = lib.mkDefault { device = "/dev/disk/by-label/nixos"; fsType = "ext4"; };
fileSystems."/boot" = lib.mkDefault { device = "/dev/disk/by-label/boot"; fsType = "vfat"; };
```

This is simpler and more robust than importing `hardware-configuration.nix` for filesystem entries. `hardware-configuration.nix` (called with `--no-filesystems`) still provides kernel modules and hardware detection.

**Fix — firstboot.nix dynamic system:**
`firstboot.nix` uses `pkgs.writeShellScriptBin` to produce the bootstrap script. The Nix string `${pkgs.stdenv.hostPlatform.system}` inside `pkgs.writeShellScriptBin` is interpolated at **Nix build time** (when the ISO or system closure is built), and baked into the script as a literal string. This is the correct mechanism — the ISO already knows its target architecture at build time, and the generated flake will reflect it. Replace the hardcoded `"x86_64-linux"` in the heredoc with `${pkgs.stdenv.hostPlatform.system}` in the `pkgs.writeShellScriptBin` string. This is not runtime-dynamic (it doesn't detect arch at install time) — it locks the generated flake to the arch of the ISO that was built, which is the correct and intended behavior.

---

## Section 2: Code Quality & Simplification

**2a.** Covered by §1 (dynamic architecture in generated flake).

**2b. Locale and timezone as configurable options**

Add to `core/os/modules/options.nix`:
```nix
nixpi.timezone = lib.mkOption { type = lib.types.str; default = "UTC"; };
nixpi.locale = lib.mkOption { type = lib.types.str; default = "en_US.UTF-8"; };
```

No validation against IANA list — accept any string, let NixOS fail-fast if invalid (same pattern used for `networking.hostName`).

Wire these options into `x86_64.nix`:
```nix
time.timeZone = config.nixpi.timezone;
i18n.defaultLocale = config.nixpi.locale;
```

**Prefill support:** The setup wizard reads `~/.nixpi/prefill.env` (or `/mnt/host-nixpi/prefill.env` in VM mode) for `NIXPI_TIMEZONE` and `NIXPI_LOCALE` environment variables. If set, skip interactive prompts and use the prefill values.

**Wizard step** (see §5a for wizard UI details): After the timezone/locale step, the wizard appends the chosen values to `/etc/nixos/nixpi-host.nix` (the same file where hostname and primaryUser are written by the existing `nixpi-bootstrap-install-host-flake` script) and runs `nixos-rebuild switch` to apply. The append writes:

```nix
nixpi.timezone = "<chosen-timezone>";
nixpi.locale = "<chosen-locale>";
```

These lines are added inside the existing `{ ... }` block in `nixpi-host.nix`. The wizard must use `sed` or a structured append that stays within the Nix attribute set — not a naive `echo >>` that would produce invalid Nix.

---

## Section 3: Resilience

**3a. WiFi hardware check before preference logic**

In `setup-wizard.sh`, before the WiFi preference step (~line 412), use the existing `has_wifi_device` helper (already defined in the script using `nmcli -t -f TYPE device status 2>/dev/null | grep -q '^wifi$'`):

```bash
if ! has_wifi_device; then
  log "no WiFi hardware detected, skipping WiFi preference"
  mark_done "wifi_preference"
  return 0
fi
```

Failure behavior: silently skip the WiFi preference step, log to `~/.nixpi/wizard.log` via the existing `log` function, and continue the wizard. Do not warn the user interactively — WiFi preference is a background optimization, not a required step.

**3b. Directory guard in system-update.sh**

Add `mkdir -p ~/.nixpi` as the first line of `system-update.sh`, before any write to `~/.nixpi/update-status.json`.

**3c. Confirmation before destructive wipe in run-installer-iso.sh**

`run-installer-iso.sh` is a developer tool that boots an installer ISO in QEMU on the host machine. Line 31 runs `rm -rf ~/.nixpi` to reset VM state between runs. Add a confirmation prompt:
```bash
echo "WARNING: This will delete ~/.nixpi (VM state reset). Continue? [y/N]"
read -r confirm
[[ "$confirm" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }
```

**3d. Firewall comment in network.nix**

Add a comment above the `trustedInterface` default in `network.nix`:
```nix
# trustedInterface defaults to "wt0" (NetBird mesh interface).
# Firewall rules referencing this interface are inert until NetBird connects.
# During first-boot setup, the system relies on SSH over the physical interface,
# which is opened separately via nixpi.security.ssh options.
nixpi.network.trustedInterface = lib.mkDefault "wt0";
```

---

## Section 4: Tests

**Real-hardware smoke test: `tools/check-real-hardware.sh`**

Usage: `./tools/check-real-hardware.sh <ip-or-hostname>`

The script SSHes in as `pi` and checks the following (each printed as PASS/FAIL):

1. **UEFI boot mode** — `[ -d /sys/firmware/efi ]`
2. **Root filesystem mounted** — `mountpoint -q /`
3. **Boot filesystem mounted** — `mountpoint -q /boot`
4. **systemd-boot present** — `[ -f /boot/EFI/systemd/systemd-bootx64.efi ]`
5. **Network reachable** — `ping -c1 1.1.1.1`
6. **NetworkManager active** — `systemctl is-active NetworkManager`
7. **Matrix service healthy** — `systemctl is-active matrix` (or whatever the unit name is)
8. **Pi daemon healthy** — `systemctl is-active nixpi-daemon` (or equivalent)
9. **Element Web accessible** — `curl -sf http://localhost:<port>` returns 200
10. **Setup wizard state** — check `~/.nixpi/checkpoints/` for presence of done markers; report "setup complete" or "setup pending"

Exit code 0 if all pass, 1 if any fail.

---

## Section 5: QoL & Documentation

**5a. Locale/timezone wizard step**

New wizard step in `setup-wizard.sh`, inserted between the network step and the password step. Checkpoint key: `locale`.

Interactive flow:
```
=== Locale & Timezone ===
Timezone [UTC]: _
Keyboard layout [us]: _
```

Common timezone suggestions printed above prompt: `UTC, Europe/Paris, Europe/London, America/New_York, America/Los_Angeles, Asia/Tokyo`.
Common keyboard layout suggestions: `us, uk, fr, de, es`.
Accept any free-form string. Write chosen values to a checkpoint file and to the host flake via `nixos-rebuild switch`.

Prefill: if `NIXPI_TIMEZONE` and `NIXPI_KEYBOARD` are set in `prefill.env`, skip interactive prompts.

**5b. Installer progress banners**

In `core/os/pkgs/installer/nixpi-installer.sh`, add `echo` banners at major phase boundaries using the existing style of the script (plain `echo`, no dialog/tput required):

```
=== [1/5] Disk selection ===
=== [2/5] Partitioning ===
=== [3/5] Installing NixOS (this may take 10-20 minutes) ===
=== [4/5] Writing boot configuration ===
=== [5/5] Finalizing ===
```

**5c. Expand docs/install.md**

The expanded doc must cover:

1. **Supported hardware** — any x86_64 UEFI PC with 4GB+ RAM, 32GB+ storage; tested on Beelink EQ14
2. **Creating the installer USB** — `dd` command from ISO
3. **Step-by-step install** — boot ISO, run `nixpi-install`, disk selection, wait for install
4. **First boot** — what the setup wizard does, how long it takes, what credentials are needed
5. **Setting up for a friend** — how to create a `prefill.env` with pre-filled values (timezone, locale, Matrix credentials, NetBird key)
6. **Troubleshooting** — log locations (`/tmp/nixpi-installer.log`, `~/.nixpi/wizard.log`), how to re-run the wizard (`setup-wizard`), how to check service status

---

## Out of Scope

- Raspberry Pi / ARM64 support (not needed for current use case)
- Multi-user support
- Network interface name parameterization beyond NetBird default
- Disko-based declarative disk management (valid future enhancement, not needed now)

---

## Section 1 Addendum: ESP Size

The installer creates a **512 MiB EFI System Partition**. systemd-boot stores each NixOS generation's kernel and initrd in the ESP. With NixOS's default of keeping multiple generations, 512 MiB fills up at ~3-4 generations, causing boot failures after updates.

**Fix:** Increase the ESP from 512 MiB to **1 GiB** in `nixpi-installer.sh`:

```bash
# Before:
parted -s "$TARGET_DISK" mkpart ESP fat32 1MiB 512MiB
parted -s "$TARGET_DISK" mkpart root ext4 512MiB ...

# After:
parted -s "$TARGET_DISK" mkpart ESP fat32 1MiB 1GiB
parted -s "$TARGET_DISK" mkpart root ext4 1GiB ...
```

Update the layout summary strings and the display comment at the top of the script accordingly. Also update swap variant partition offsets.

**Why 1 GiB:** 2025 community recommendation for systemd-boot. Each kernel+initrd pair is ~50-100 MB. 1 GiB supports 10+ generations comfortably.

---

## Implementation Order

1. **§1 + ESP fix** — Label-based fileSystems in x86_64.nix, hardware-configuration.nix import in firstboot, dynamic system string, ESP 1 GiB, `--no-filesystems` in installer (all hardware portability together)
2. **§3** — Resilience fixes (low-risk, independent)
3. **§2b + §5a + §3a** — Locale/timezone options + wizard step + WiFi check (all touch setup-wizard.sh, do in one pass)
4. **§4** — Smoke test script
5. **§5b** — Installer progress banners
6. **§5c** — Documentation
