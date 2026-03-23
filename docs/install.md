---
title: Install NixPI
description: Build the installer, boot into NixPI, and finish the first-boot flow.
---

<SectionHeading
  label="Install path"
  title="The shortest path from repository to running machine"
  lede="NixPI currently assumes a technical operator. The install flow is direct: build the installer image, boot it, run the installer, then finish the first-boot setup inside the new system."
/>

<PresentationBand
  eyebrow="Quick path"
  title="From source tree to live system"
  lede="This is the fastest public-facing install narrative. The full operational detail remains in the docs section."
>

<TerminalFrame title="Quick Install">
```bash
nix build .#installerIso

# write the generated ISO to a USB stick and boot it
sudo -i
nixpi-installer

# after reboot
setup-wizard.sh
```
</TerminalFrame>

</PresentationBand>

## What happens during setup

<div class="quick-grid">
  <div class="quick-card">
    <strong>1. Build the installer</strong>
    The repository produces a NixPI installer ISO through the flake output.
  </div>
  <div class="quick-card">
    <strong>2. Boot the live environment</strong>
    Use the generated image on a USB stick or test it inside a VM first.
  </div>
  <div class="quick-card">
    <strong>3. Run the installer</strong>
    The installer prepares a minimal bootable NixPI base on the target system.
  </div>
  <div class="quick-card">
    <strong>4. Finish first boot</strong>
    The wizard brings up WiFi, prefers it over Ethernet when both are available, clones `~/nixpi`, writes `/etc/nixos`, and promotes the machine into the full appliance.
  </div>
</div>

The installed system now boots into the official NixPI XFCE desktop automatically. That desktop remains intentionally minimal and agent-friendly, and it is the only supported automatic first-boot entry path: XFCE opens the NixPI terminal, the terminal runs setup if needed, and later launches Pi.

<PresentationBand
  eyebrow="After install"
  title="Operate the machine from the local checkout"
  lede="Once the system is live, you edit and sync NixPI in `~/nixpi`, while `/etc/nixos` remains the deployed host flake used for rebuilds."
>

<TerminalFrame title="Post-install workflow">
```bash
cd ~/nixpi
git fetch upstream
git rebase upstream/main
sudo nixos-rebuild switch --flake /etc/nixos#$(hostname -s)
```
</TerminalFrame>

</PresentationBand>

---

## Supported hardware

NixPI runs on any **x86_64 UEFI PC** with:

- 4 GB RAM or more
- 32 GB storage or more
- A wired or wireless network interface

The reference machine is a **Beelink EQ14** (Intel N100, 16 GB RAM, 500 GB NVMe). Any similar mini-PC or laptop with a UEFI firmware will work. Legacy BIOS boot is not supported.

---

## Creating the installer USB

Build the ISO from the repository root:

```bash
nix build .#installerIso
```

The ISO lands at `result/iso/nixpi-installer.iso`. Write it to a USB stick (replace `/dev/sdX` with your actual device — double-check with `lsblk`):

```bash
sudo dd if=result/iso/nixpi-installer.iso of=/dev/sdX bs=4M status=progress oflag=sync
```

Eject the drive and boot the target machine from it. In the UEFI boot menu select the USB entry; the live environment drops to a root shell automatically.

---

## Step-by-step install

1. Boot the USB. You land at a root shell in the NixPI live environment.
2. Run the installer:

   ```bash
   nixpi-installer
   ```

   The installer lists available disks and prompts you to pick one. All data on the selected disk will be erased.

3. Confirm the disk selection. The installer partitions the disk (EFI partition + ext4 root), installs the base NixOS closure, and writes a bootloader.

4. When the installer finishes it prints a success message. Remove the USB stick and reboot:

   ```bash
   reboot
   ```

The installer log is written to `/tmp/nixpi-installer.log` during the install session. If something goes wrong, read that file before rebooting.

---

## First boot

After the reboot the machine boots into the NixPI XFCE desktop and opens a terminal automatically. The terminal runs `setup-wizard` if the system has not been set up yet.

The wizard walks through these steps in order:

1. **Network** — connects to WiFi (or uses Ethernet if already connected) and validates internet access.
2. **Identity** — prompts for a display name, email address, and Linux username.
3. **Password** — sets the primary account password.
4. **Timezone and keyboard** — sets locale preferences.
5. **Matrix** — creates a local Matrix account used by the Pi AI agent.
6. **NetBird** — joins the secure overlay network so you can reach the machine remotely.
7. **System promotion** — clones `~/nixpi`, writes `/etc/nixos`, and runs a full `nixos-rebuild switch` to activate the complete appliance profile.

The promotion step (step 7) downloads and compiles NixOS packages. On a fast connection this takes **10–20 minutes**. The screen shows a progress log throughout.

After the wizard completes the machine reboots one final time into the fully configured appliance. The default login credentials are whatever username and password you entered during the wizard.

---

## Setting up for a friend

If you are installing NixPI on behalf of someone else you can pre-fill the wizard answers so the machine sets itself up without manual input. Create a file at `~/.nixpi/prefill.env` (on the target machine, before first boot, or place it there via USB):

```bash
# ~/.nixpi/prefill.env
PREFILL_NAME="Alice Smith"
PREFILL_EMAIL="alice@example.com"
PREFILL_USERNAME="alice"
PREFILL_PRIMARY_PASSWORD="change-me-on-first-login"
PREFILL_MATRIX_PASSWORD="another-strong-password"
PREFILL_NETBIRD_KEY="nbkey-xxxxxxxxxxxxxxxxxxxx"
NIXPI_TIMEZONE="America/New_York"
NIXPI_KEYBOARD="us"
```

All variables are optional — the wizard will prompt interactively for any that are missing. When the file exists the wizard runs non-interactively and the machine finishes setup without any input from the person sitting in front of it.

Common timezone values: `Europe/London`, `Europe/Berlin`, `America/Los_Angeles`, `Asia/Tokyo`.
Common keyboard values: `us`, `uk`, `de`, `fr`, `es`.

To deliver the machine: complete the physical install, place the `prefill.env` file, and hand it over. The recipient just needs to power it on and wait.

---

## Troubleshooting

### Log files

| Log | What it covers |
|-----|----------------|
| `/tmp/nixpi-installer.log` | Installer output (disk partitioning, NixOS base install). Available only during the live USB session. |
| `~/.nixpi/wizard.log` | First-boot wizard output. Persists on the installed system across reboots. |
| `~/.nixpi/bootstrap/full-appliance-upgrade.log` | NixOS rebuild log from the promotion step. |

### Re-running the wizard

If the wizard was interrupted or you want to re-run a step:

```bash
setup-wizard
```

The wizard uses checkpoints stored in `~/.nixpi/wizard-state/`. It resumes from the last incomplete step. To force a full re-run, remove the state directory:

```bash
rm -rf ~/.nixpi/wizard-state
setup-wizard
```

### Checking service status

```bash
# Check all NixPI-related systemd services
systemctl --user status

# Check a specific service, e.g. the Matrix homeserver
systemctl status matrix-conduit

# Follow wizard log in real time
tail -f ~/.nixpi/wizard.log
```

### Common issues

**Machine does not boot from USB** — enter the UEFI firmware (usually F2, F12, or Del at power-on) and confirm that Secure Boot is disabled and the USB device is first in the boot order.

**Installer cannot find any disks** — run `lsblk` to list disks. If the NVMe drive is not visible the storage controller may need a different AHCI/NVMe mode in UEFI settings.

**Wizard fails during promotion** — check `~/.nixpi/bootstrap/full-appliance-upgrade.log` for the error. The most common cause is a temporary network interruption. Re-run `setup-wizard` to retry from the last checkpoint.

---

## Need more detail?

- [Operations: Quick Deploy](./operations/quick-deploy)
- [Operations: First Boot Setup](./operations/first-boot-setup)
- [Operations](./operations/)
