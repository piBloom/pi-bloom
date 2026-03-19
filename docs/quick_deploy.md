# Bloom OS Quick Deploy

> 📖 [Emoji Legend](LEGEND.md)

Audience: operators and maintainers building images or booting test VMs.

> 🛡️ **Security Note: NetBird is Mandatory**
>
> NetBird is the network security boundary for all Bloom services. The firewall
> trusts only the NetBird interface (`wt0`). Without NetBird running, all services
> (Matrix, Bloom Home, dufs, code-server) are exposed to the local network.
>
> **Complete NetBird setup and verify `wt0` is active before exposing this
> machine to any network.** See [security-model.md](security-model.md) for the
> full threat model.

## 🌱 Why This Guide Exists

This guide is the operational path for building and booting Bloom from the current `justfile`.

Use it for:

- local image builds (qcow2, raw, ISO)
- QEMU test boots
- ISO generation
- bare-metal NixOS installs

## 🚀 How To Build And Boot Bloom

### Prerequisites

Install [Nix](https://determinate.systems/posts/determinate-nix-installer/) and `just`:

```bash
curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install
sudo dnf install -y just qemu-system-x86 edk2-ovmf   # Fedora build host
```

Or install all deps at once:

```bash
just deps
```

### Fast Dev Path: QEMU

```bash
just qcow2   # build the NixOS qcow2 image
just vm      # boot it in QEMU (headless, serial console)
```

Forwarded ports in `just vm`:

- `2222` -> guest SSH
- `5000` -> `dufs`
- `8080` -> guest port `8080`
- `8081` -> `fluffychat`
- `8888` -> guest port `80`

Default user: `pi` (no initial password; TTY auto-login prompts for password creation on first boot).

Access the VM:

```bash
just vm-ssh
```

Stop it:

```bash
just vm-kill
```

## 💿 Installer Media

Bloom ships two supported install paths that converge on the same first-boot flow:

| Path | Artifact | Best For |
|------|----------|----------|
| **USB installer** | `just iso` | Mini PCs, bare-metal installs, guided local setup |
| **Raw image** | `just raw` | Appliance-style installs and direct disk flashing |

### USB Installer (Recommended for Mini PCs)

The USB installer boots to a minimal console environment and provides the `bloom-install` helper.

#### Build USB Installer ISO

```bash
just iso
```

#### Flash to USB

```bash
sudo dd if=result/iso/*.iso of=/dev/sdX bs=4M status=progress conv=fsync
```

Replace `/dev/sdX` with your USB device (check with `lsblk`).

#### Install on the Mini PC

Boot from the installer USB, then:

```bash
sudo bloom-install
```

`bloom-install` prompts for:

- target disk
- hostname
- timezone
- locale
- keyboard layout

It then runs `disko-install` fully offline using the sources bundled into the ISO.

After installation:

1. reboot
2. remove the USB stick
3. log into the installed system
4. complete `bloom-wizard.sh` on first boot

#### Test the USB Workflow in QEMU

```bash
just test-iso
```

This boots the minimal installer in a serial console.

### Raw Image Path

Build the raw image:

```bash
just raw
```

Write it to the target disk:

```bash
sudo dd if=result/*raw* of=/dev/sdX bs=4M status=progress conv=fsync
```

On first boot, complete `bloom-wizard.sh` the same way as the USB-installed system.

## 🔄 OTA Updates

The `bloom-update` timer checks for updates every 6 hours automatically. To apply manually:

```bash
just update          # pull from remote flake and switch
just rollback        # revert to previous generation
```

## 📚 Reference

Important outputs (all via `result` symlink):

| Output | Path | Description |
|--------|------|-------------|
| qcow2 | `result/nixos.qcow2` | VM disk image |
| ISO | `result/iso/bloom-os-installer.iso` | USB installer |
| Raw disk | `result/` | Raw disk image for `dd` |

Related `just` commands:

```bash
just deps            # Install build dependencies
just clean           # Remove build artifacts
just lint            # Run nix flake check
just fmt             # Format Nix files

# ISO commands
just iso             # Build USB installer ISO
just test-iso        # Test USB installer ISO in QEMU

# VM commands
just qcow2           # Build qcow2 image
just vm              # Run VM (headless)
just vm-gui          # Run VM with GUI display
just vm-ssh          # SSH into running VM
just vm-kill         # Stop running VM
```

After first login:

1. complete `bloom-wizard.sh` (prompted automatically on tty1)
2. let Pi resume the persona step
3. use `setup_status` if you need to inspect or resume Pi-side setup state

## 🔗 Related

- [pibloom-setup.md](pibloom-setup.md)
- [live-testing-checklist.md](live-testing-checklist.md)
