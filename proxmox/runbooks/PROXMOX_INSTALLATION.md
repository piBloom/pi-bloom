# Proxmox VE 9 installation runbook

Date: 2026-05-19
Host/IP: `167.235.12.22`
Target hostname: `proxmox`
Provider mode used: Hetzner Rescue System

## Summary

The previous Proxmox VE 8.4 install was intentionally wiped and replaced with a fresh Debian 13 Trixie base plus Proxmox VE 9 from the official Proxmox repository.

The reinstall was chosen instead of an in-place PVE 8 -> 9 upgrade because the host had just been rebuilt and had no VM/container state to preserve.

Destructive action confirmed by the operator before running Hetzner `installimage`: both NVMe disks, `/dev/nvme0n1` and `/dev/nvme1n1`, were wiped.

## Current architecture

### Physical disks

Two NVMe disks:

- `/dev/nvme0n1` — Samsung 512 GB NVMe, serial `S675NX0T505998`
- `/dev/nvme1n1` — Samsung 512 GB NVMe, serial `S675NX0T505978`

### RAID layout

Hetzner `installimage` created Linux software RAID1 across both disks:

- `/dev/md0`
  - RAID1 over `nvme0n1p1` and `nvme1n1p1`
  - Size: about 1 GiB
  - Filesystem: ext3
  - Mountpoint: `/boot`

- `/dev/md1`
  - RAID1 over `nvme0n1p2` and `nvme1n1p2`
  - Size: about 476 GiB
  - Used as LVM physical volume

### LVM layout

Volume group: `vg0`

Logical volumes:

- `/dev/vg0/root`
  - Size: 80 GiB
  - Filesystem: ext4
  - Mountpoint: `/`

- `/dev/vg0/swap`
  - Size: 8 GiB
  - Type: swap

- `/dev/vg0/data`
  - Size: remaining space, about 388 GiB
  - Filesystem: ext4
  - Mountpoint: `/var/lib/vz`
  - Purpose: default Proxmox local VM/container/template/ISO storage path

## Installed software stack

Base OS:

- Debian GNU/Linux 13 Trixie, installed via Hetzner `installimage`

Proxmox stack verified after boot:

- `proxmox-ve` 9.1.0
- `pve-manager` 9.1.16
- Running kernel: `7.0.2-4-pve`
- Proxmox kernel package: `proxmox-kernel-7.0.2-4-pve-signed`
- Supporting packages installed explicitly:
  - `postfix`
  - `open-iscsi`
  - `chrony`
  - `ifupdown2`

## Package repositories

The Proxmox no-subscription repository is configured with modern deb822 source format:

```text
Types: deb
URIs: http://download.proxmox.com/debian/pve
Suites: trixie
Components: pve-no-subscription
Signed-By: /usr/share/keyrings/proxmox-archive-keyring.gpg
```

The Proxmox Trixie archive key was installed from the official URL:

```bash
wget https://enterprise.proxmox.com/debian/proxmox-archive-keyring-trixie.gpg \
  -O /usr/share/keyrings/proxmox-archive-keyring.gpg
```

The checksum was verified:

```text
136673be77aba35dcce385b28737689ad64fd785a797e57897589aed08db6e45  /usr/share/keyrings/proxmox-archive-keyring.gpg
```

The subscription-only enterprise repository file exists because Proxmox creates it, but it is disabled:

```text
/etc/apt/sources.list.d/pve-enterprise.sources
Enabled: no
```

`apt-get update` completed successfully after disabling the enterprise repo.

## Network architecture

Public IPv4:

```text
167.235.12.22/26
Gateway: 167.235.12.1
```

Public IPv6:

```text
2a01:4f8:262:1b01::2/64
Gateway: fe80::1
```

Physical interface:

```text
enp0s31f6
```

Proxmox bridge:

```text
vmbr0
```

`/etc/network/interfaces` assigns the public IPs to `vmbr0`, with `enp0s31f6` as the bridge port. This is the standard Proxmox layout for attaching guests to a host bridge.

Configured interface file:

```text
### Hetzner Online GmbH installimage / Proxmox VE bridge config

source /etc/network/interfaces.d/*

auto lo
iface lo inet loopback
iface lo inet6 loopback

auto enp0s31f6
iface enp0s31f6 inet manual

auto vmbr0
iface vmbr0 inet static
  address 167.235.12.22/26
  gateway 167.235.12.1
  bridge-ports enp0s31f6
  bridge-stp off
  bridge-fd 0

iface vmbr0 inet6 static
  address 2a01:4f8:262:1b01::2/64
  gateway fe80::1
```

## Installation procedure actually used

### 1. Confirmed rescue access

Connected to Hetzner rescue system using the dedicated Proxmox root key:

```bash
ssh -i ~/.ssh/proxmox_root_ed25519 -o IdentitiesOnly=yes root@167.235.12.22
```

Rescue environment observed:

```text
Debian GNU/Linux 12 (bookworm)
Linux rescue 6.12.67
```

### 2. Confirmed no guest state to preserve

The previous installed root was inspected before wiping. No VM/container configs were found under `/etc/pve`, and no files were found under `/var/lib/vz`.

### 3. Created Hetzner installimage config

Config written to `/autosetup` in rescue mode:

```text
DRIVE1 /dev/nvme0n1
DRIVE2 /dev/nvme1n1
SWRAID 1
SWRAIDLEVEL 1
BOOTLOADER grub
HOSTNAME proxmox
PART /boot ext3 1024M
PART lvm vg0 all
LV vg0 root / ext4 80G
LV vg0 swap swap swap 8G
LV vg0 data /var/lib/vz ext4 all
IMAGE /root/.oldroot/nfs/images/Debian-1303-trixie-amd64-base.tar.zst
```

The image and detached signature were present in Hetzner rescue:

```text
/root/.oldroot/nfs/images/Debian-1303-trixie-amd64-base.tar.zst
/root/.oldroot/nfs/images/Debian-1303-trixie-amd64-base.tar.zst.sig
```

### 4. Ran installimage

```bash
/root/.oldroot/nfs/install/installimage -a -c /autosetup
```

Result: Debian 13 installation completed successfully and copied rescue SSH keys for root login.

### 5. Mounted installed system from rescue

```bash
mount /dev/vg0/root /mnt
mount /dev/md0 /mnt/boot
mount /dev/vg0/data /mnt/var/lib/vz
mount --bind /dev /mnt/dev
mount --bind /dev/pts /mnt/dev/pts
mount --bind /proc /mnt/proc
mount --bind /sys /mnt/sys
cp -a /etc/resolv.conf /mnt/etc/resolv.conf
```

### 6. Added Proxmox VE 9 repository and key

```bash
cat > /etc/apt/sources.list.d/pve-install-repo.sources <<'EOF'
Types: deb
URIs: http://download.proxmox.com/debian/pve
Suites: trixie
Components: pve-no-subscription
Signed-By: /usr/share/keyrings/proxmox-archive-keyring.gpg
EOF

wget -q https://enterprise.proxmox.com/debian/proxmox-archive-keyring-trixie.gpg \
  -O /usr/share/keyrings/proxmox-archive-keyring.gpg
sha256sum /usr/share/keyrings/proxmox-archive-keyring.gpg
```

### 7. Installed Proxmox kernel first

Following the official Debian 13/Trixie install flow, the Proxmox kernel was installed first:

```bash
apt-get update
apt-get -y full-upgrade
apt-get -y install proxmox-default-kernel sudo ca-certificates wget curl gnupg chrony
update-grub
```

GRUB was explicitly installed to both disks in BIOS/legacy mode:

```bash
grub-install --target=i386-pc --recheck /dev/nvme0n1
grub-install --target=i386-pc --recheck /dev/nvme1n1
update-grub
```

The agent environment blocked direct reboot commands, so the server was rebooted from the Hetzner console.

### 8. Booted into Proxmox kernel

After reboot from disk:

```text
hostname: proxmox
OS: Debian GNU/Linux 13 (trixie)
running kernel: 7.0.2-4-pve
```

### 9. Installed full Proxmox VE packages

```bash
export DEBIAN_FRONTEND=noninteractive
printf "postfix postfix/main_mailer_type select Local only\npostfix postfix/mailname string proxmox\n" | debconf-set-selections
apt-get update
apt-get -y full-upgrade
apt-get -y install proxmox-ve postfix open-iscsi chrony ifupdown2
apt-get -y remove linux-image-amd64 os-prober || true
apt-get -f -y install
dpkg --configure -a
dpkg --audit
```

During package configuration, `pve-manager.postinst` ran `pveam update`; it downloaded `aplinfo-pve-9.dat.asc` and `aplinfo-pve-9.dat.gz` successfully but the `pveam` process remained open. It was terminated, after which package configuration finished cleanly. `dpkg --audit` returned no output.

### 10. Configured Proxmox bridge networking

The network was hot-applied with:

```bash
ifquery --interfaces=/etc/network/interfaces --list
ifreload -a
```

Observed after reload:

```text
lo               UNKNOWN        127.0.0.1/8 ::1/128
enp0s31f6        UP
vmbr0            UP             167.235.12.22/26 2a01:4f8:262:1b01::2/64 fe80::921b:eff:fe9e:ebf6/64
default via 167.235.12.1 dev vmbr0 proto kernel onlink
```

## SSH keys and local admin users

Two distinct local SSH keypairs are used for this Proxmox host:

```text
Root SSH key private path: /home/alex/.ssh/proxmox_root_ed25519
Root SSH key public path:  /home/alex/.ssh/proxmox_root_ed25519.pub
Root SSH key fingerprint:  SHA256:t56t2uixbWVGTdE9ZZN+B02uynZBlVd/pw7hefPYbj8

Alex SSH key private path: /home/alex/.ssh/proxmox_alex_ed25519
Alex SSH key public path:  /home/alex/.ssh/proxmox_alex_ed25519.pub
Alex SSH key fingerprint:  SHA256:YDim1O8Kj/tE5QX/OverZffIRgJQMSO1yi4WwmLhLRk
```

The installed system is configured with:

- `/root/.ssh/authorized_keys` containing only the Proxmox root public key.
- `/home/alex/.ssh/authorized_keys` containing only the Proxmox alex public key.
- Linux user `alex` created with UID/GID 1000.
- `alex` added to the `sudo` group.
- `/etc/sudoers.d/alex` granting sudo access.
- `alex@pam` created in Proxmox and granted `Administrator` at `/`.

SSH hardening file:

```text
/etc/ssh/sshd_config.d/99-proxmox-hardening.conf
```

Contents:

```text
PermitRootLogin prohibit-password
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
```

Generated PAM passwords for `root` and `alex` are stored outside the repository on the laptop at:

```text
/home/alex/.hermes/secrets/proxmox-ve9-credentials-20260519-143208.txt
```

Note: the initial `alex_password` entry was malformed during generation and was reset on 2026-05-19. The current `alex_password` in this file was applied to the host with `chpasswd` and verified against the Proxmox API as `alex@pam`.

Use the `alex` PAM password for the Proxmox web UI login as `alex@pam`, then rotate it when convenient.

Preferred SSH access:

```bash
ssh proxmox
```

Break-glass root SSH:

```bash
ssh proxmox-root
```

Raw IP access requires the dedicated key, for example:

```bash
ssh -i ~/.ssh/proxmox_alex_ed25519 -o IdentitiesOnly=yes alex@167.235.12.22
```

## Verification performed on 2026-05-19

These checks passed after the Proxmox VE 9 install:

- `ssh proxmox` logs in as Linux user `alex` using `/home/alex/.ssh/proxmox_alex_ed25519`.
- `ssh proxmox-root` logs in as `root` using `/home/alex/.ssh/proxmox_root_ed25519`.
- `uname -r` returns `7.0.2-4-pve`.
- `pveversion` returns `pve-manager/9.1.16/f96ca511ec69e73c`.
- `pveversion -v` reports `proxmox-ve: 9.1.0`.
- `dpkg --audit` returns no broken-package output.
- Active services:
  - `pve-cluster`
  - `pvedaemon`
  - `pveproxy`
  - `pvestatd`
  - `chrony`
  - `ssh`
- `ss -ltnp` shows SSH listening on TCP 22 and `pveproxy` listening on TCP 8006.
- `alex@pam` exists and has `Administrator` ACL at `/`.
- `pvesm status` reports local storage active at `/var/lib/vz`.
- RAID arrays are healthy (`[UU]`); `md1` resync completed after verification.
- Host networking is on the Proxmox bridge layout:
  - `vmbr0` has `167.235.12.22/26` and `2a01:4f8:262:1b01::2/64`.
  - `enp0s31f6` is the bridge port and has no direct IP.

Direct local/web access from the host works:

```bash
curl -k https://127.0.0.1:8006/
curl -k https://167.235.12.22:8006/
```

An SSH tunnel from the laptop also works:

```bash
ssh -N -L 127.0.0.1:8006:127.0.0.1:8006 proxmox
```

Then open:

```text
https://127.0.0.1:8006/
```

Tunnel verification returned the Proxmox UI title:

```text
proxmox - Proxmox Virtual Environment
```

Direct TCP from the Hermes/laptop environment to `167.235.12.22:8006` timed out even though the host-local curl works and `pveproxy` listens on `*:8006`. SSH access on port 22 works. Until provider/network filtering for 8006 is confirmed, use the SSH tunnel above for the UI.

## Important operational notes

- This server is now managed as a Proxmox VE 9 host, not as the previous NixOS `nazar` host.
- The old Proxmox VE 8.4 install was intentionally wiped.
- `/var/lib/vz` is a dedicated ext4 LV on mirrored NVMe storage.
- The current layout uses classic Linux bridge networking (`vmbr0`) for Proxmox guests.
- SSH is key-only; root SSH is allowed only with keys (`PermitRootLogin prohibit-password`).
- The Proxmox UI should preferably be accessed through SSH tunnel/Tailscale/VPN instead of being broadly exposed to the public internet.
- Before creating guests, decide whether to use public bridged networking, routed additional IPs, NAT, or a private overlay such as Tailscale.

## Recovery notes

If the host does not boot correctly:

1. Boot Hetzner rescue.
2. Assemble/mount installed system:

```bash
vgchange -ay
mount /dev/vg0/root /mnt
mount /dev/md0 /mnt/boot
mount /dev/vg0/data /mnt/var/lib/vz
mount --bind /dev /mnt/dev
mount --bind /dev/pts /mnt/dev/pts
mount --bind /proc /mnt/proc
mount --bind /sys /mnt/sys
```

3. Enter chroot:

```bash
chroot /mnt /bin/bash
```

4. Inspect bootloader and kernels:

```bash
ls -lh /boot/vmlinuz-* /boot/initrd.img-*
grub-install --target=i386-pc --recheck /dev/nvme0n1
grub-install --target=i386-pc --recheck /dev/nvme1n1
update-grub
```

5. Inspect network config:

```bash
ifquery --interfaces=/etc/network/interfaces --list
sed -n '1,220p' /etc/network/interfaces
```

6. Inspect packages:

```bash
dpkg --audit
apt-get -f install
pveversion -v
```

## Follow-up TODOs

- Decide whether Proxmox UI should remain public on TCP 8006 or be restricted behind SSH/Tailscale/VPN.
- Decide guest networking model.
- Add backup target.
- Add monitoring and alerting for RAID, SMART, Proxmox services, and storage usage.
