# Quick Deploy

> Build, install, and validate NixPI

## Audience

Operators and maintainers installing NixPI from the official installer image or validating local builds.

## Security Note: NetBird Is Mandatory

NetBird is the network security boundary for all NixPI services. The firewall trusts only the NetBird interface (`wt0`). Without NetBird running, all services (Matrix, Home, Element Web) are exposed to the local network.

**Complete NetBird setup and verify `wt0` is active before exposing this machine to any network.** See [Security Model](../reference/security-model) for the full threat model.

## Installation Workflow

NixPI ships as a minimal NixOS installer image. It boots to a console and exposes a destructive terminal installer wizard as `nixpi-installer`.

### 1. Build or Download the Installer ISO

Build locally:

```bash
nix build .#installerIso
```

The resulting image is in `./result/iso/`.

### 2. Write the Image to USB

Use your preferred image writer, or from a Linux host:

```bash
sudo dd if=./result/iso/*.iso of=/dev/<usb-device> bs=4M status=progress oflag=sync
```

### 3. Install NixPI

1. Boot the USB stick
2. Open a root shell with `sudo -i`
3. Run `nixpi-installer`
4. Choose the target disk
5. Choose the disk layout:
   - `EFI + ext4 root`
   - `EFI + ext4 root + 8GiB swap`
   - `EFI + ext4 root + custom swap`
6. Enter the hostname and primary user
7. Confirm the destructive install
8. Reboot into the installed system

The installer writes a minimal bootable NixPI base in `/etc/nixos`. The full host flake and local `~/nixpi` checkout are created during first-boot setup after the machine has network access.

### 4. Complete Setup

After reboot, the installed system should autologin into the Openbox desktop and open the NixPI terminal automatically. If the setup wizard does not appear there, run:

```bash
setup-wizard.sh
```

During first boot, the wizard:

1. Connects the machine to WiFi and prefers it over Ethernet when both are usable
2. Clones the NixPI checkout into `~/nixpi`
3. Writes the host-specific flake under `/etc/nixos`
4. Runs `sudo nixos-rebuild switch --flake /etc/nixos#$(hostname -s)` to promote the system into the full appliance

## Development: Local Builds and VM Testing

For development and testing, use the QEMU VM workflow.

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

### Common Commands

```bash
just iso             # Build the installer ISO
just vm              # Build and run VM (headless, serial console)
just vm-ssh          # SSH into running VM
just vm-stop         # Stop the VM
just check-config    # Fast: validate NixOS config
just check-boot      # Thorough: boot test in VM
```

**Default operator user**: the user chosen during `nixpi-installer`. That same primary operator account is the normal local and always-on Pi runtime identity.

## OTA Updates

Use `~/nixpi` as the canonical editable source of truth for an installed system. Treat `/etc/nixos` as deployed compatibility state, not the repo you edit or sync.

The recommended fork-first workflow is:

```bash
git clone <your-fork-url> ~/nixpi
cd ~/nixpi
git remote add upstream https://github.com/alexradunet/nixpi.git
```

To apply local changes manually:

```bash
cd ~/nixpi
sudo nixos-rebuild switch --flake /etc/nixos#$(hostname -s)
```

To sync with upstream and rebuild:

```bash
cd ~/nixpi
git fetch upstream
git rebase upstream/main
git push origin main
sudo nixos-rebuild switch --flake /etc/nixos#$(hostname -s)
```

Automatic updates remain local-only and do not `git pull` for the user. Syncing a fork with upstream stays a manual step so local customizations remain under the operator's control.

To roll back:

```bash
sudo nixos-rebuild switch --rollback
```

## Related

- [First Boot Setup](./first-boot-setup)
- [Live Testing](./live-testing)
- [Security Model](../reference/security-model)
