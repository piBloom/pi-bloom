# Phase 1 Completion — NixOS Guest Foundation

Date: 2026-05-19

## Status

Phase 1 is complete and verified.

The Proxmox host now has a private guest network and one declarative NixOS guest VM named `edge`. The guest is reachable over SSH through the Proxmox host, can reach the internet through NAT, has the QEMU guest agent working, and can be redeployed with `nixos-rebuild` from the local development machine.

## Infrastructure state

### Proxmox host

```text
Host: proxmox
Public IP: 167.235.12.22
Public bridge: vmbr0
Private bridge: vmbr1
Private bridge IP: 10.10.10.1/24
Private guest subnet: 10.10.10.0/24
```

### Guest VM

```text
VM ID: 100
Name: edge
Role: NixOS foundation VM / future reverse proxy
Private IP: 10.10.10.10/24
Gateway: 10.10.10.1
DNS: 1.1.1.1, 9.9.9.9
CPU: 1 core
RAM: 1024 MiB
Disk: 16 GiB qcow2 on local storage
Network: virtio on vmbr1
QEMU guest agent: enabled and verified
On boot: enabled
```

## Files added locally

```text
/home/alex/repos/ownloom/infra/
├── flake.nix
├── flake.lock
├── hosts/
│   └── edge/
│       └── configuration.nix
└── modules/
    ├── common.nix
    ├── proxmox-image.nix
    └── proxmox-vm.nix
```

Also added/updated:

```text
/home/alex/repos/ownloom/proxmox/runbooks/NIXOS_GUEST_PHASES.md
/home/alex/repos/ownloom/proxmox/runbooks/PHASE_1_COMPLETION.md
```

## Proxmox host configuration

### Private bridge

`/etc/network/interfaces` contains:

```text
auto vmbr1
iface vmbr1 inet static
  address 10.10.10.1/24
  bridge-ports none
  bridge-stp off
  bridge-fd 0
```

### IPv4 forwarding

Configured via:

```text
/etc/sysctl.d/99-ownloom-private-guests.conf
```

Expected value:

```text
net.ipv4.ip_forward=1
```

Verification command:

```bash
ssh proxmox-root 'sysctl net.ipv4.ip_forward'
```

Expected:

```text
net.ipv4.ip_forward = 1
```

### NAT

`/etc/nftables.conf` contains the current NAT table for Nazar guests:

```nft
table ip ownloom_nat {
  chain postrouting {
    type nat hook postrouting priority srcnat; policy accept;
    ip saddr 10.10.10.0/24 oifname "vmbr0" masquerade
  }
}
```

Verification command:

```bash
ssh proxmox-root 'nft list table ip ownloom_nat'
```

## NixOS flake details

### `infra/flake.nix`

Provides:

- `nixosConfigurations.edge`
- `packages.x86_64-linux.edge-qcow`
- `checks.x86_64-linux.edge-toplevel`

The flake currently uses:

```nix
nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";
nixos-generators.url = "github:nix-community/nixos-generators";
```

### `infra/modules/common.nix`

Shared guest defaults:

- timezone: UTC
- OpenSSH enabled
- password and keyboard-interactive SSH disabled
- root SSH disabled
- `alex` user with wheel access
- passwordless sudo for wheel
- Nix flakes enabled
- `alex` trusted for Nix remote deployment
- baseline packages: `curl`, `git`, `htop`, `vim`, `wget`

### `infra/modules/proxmox-vm.nix`

Important Proxmox VM settings:

```nix
services.qemuGuest.enable = true;
boot.loader.grub.device = "/dev/vda";
boot.growPartition = true;
fileSystems."/".device = "/dev/disk/by-label/nixos";
networking.useDHCP = false;
```

It also explicitly includes VirtIO/initrd modules:

```nix
boot.initrd.availableKernelModules = [
  "ata_piix"
  "uhci_hcd"
  "virtio_pci"
  "virtio_blk"
  "virtio_scsi"
  "sd_mod"
  "sr_mod"
];
```

This is required for reliable boot after `nixos-rebuild`. Without it, the rebuilt system can fail in NixOS stage 1 while waiting for `/dev/disk/by-label/nixos`.

### `infra/hosts/edge/configuration.nix`

Current guest config:

```text
hostname: edge
interface: ens18
address: 10.10.10.10/24
gateway: 10.10.10.1
nameservers: 1.1.1.1, 9.9.9.9
firewall allowed TCP ports: 22
system.stateVersion: 25.11
```

## Build and deployment commands

### Validate the flake locally

```bash
cd /home/alex/repos/ownloom/infra
nix flake check --no-build
```

Expected result:

```text
all checks passed!
```

### Build the qcow image

```bash
cd /home/alex/repos/ownloom/infra
nix build .#packages.x86_64-linux.edge-qcow --print-out-paths
```

Output image:

```text
result/nixos.qcow2
```

The `result` symlink should not be committed.

### Deploy to the running VM

```bash
cd /home/alex/repos/ownloom/infra

NIX_SSHOPTS='-o ProxyJump=proxmox -i /home/alex/.ssh/proxmox_alex_ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new' \
  nixos-rebuild switch \
  --flake .#edge \
  --target-host alex@10.10.10.10 \
  --sudo \
  --no-reexec
```

Do not build directly on the 1 GiB guest unless necessary; it can OOM. Prefer building locally and copying closures with `--target-host`.

## Access commands

### Proxmox host as normal admin

```bash
ssh proxmox
```

### Proxmox host as root

```bash
ssh proxmox-root
```

### Edge guest

```bash
ssh -i ~/.ssh/proxmox_alex_ed25519 \
  -o IdentitiesOnly=yes \
  -J proxmox \
  alex@10.10.10.10
```

Suggested local SSH config:

```sshconfig
Host edge
  HostName 10.10.10.10
  User alex
  ProxyJump proxmox
  IdentityFile ~/.ssh/proxmox_alex_ed25519
  IdentitiesOnly yes
```

Then:

```bash
ssh edge
```

If the VM is destroyed/recreated, clear the old host key:

```bash
ssh-keygen -R 10.10.10.10
```

## Verification checklist

Run from the local development machine.

### Proxmox bridge/NAT/VM checks

```bash
ssh proxmox-root 'set -e
qm status 100
qm config 100 | grep -E "^(name|memory|cores|net0|virtio0|agent|boot|onboot|vga):"
ip -br addr show vmbr1
sysctl net.ipv4.ip_forward
nft list table ip ownloom_nat
ping -c2 -W2 10.10.10.10
qm agent 100 ping
qm agent 100 network-get-interfaces
'
```

Verified results on 2026-05-19:

```text
VM 100 status: running
vmbr1: 10.10.10.1/24
net.ipv4.ip_forward = 1
nft ownloom_nat masquerade rule present
ping 10.10.10.10: 0% packet loss
qm agent 100 ping: success
agent reported ens18 = 10.10.10.10/24
```

### Guest checks

```bash
ssh -i ~/.ssh/proxmox_alex_ed25519 \
  -o IdentitiesOnly=yes \
  -J proxmox \
  alex@10.10.10.10 'set -e
hostname
ip -br addr show ens18
ip route
systemctl is-active sshd qemu-guest-agent
nix --version
nix config show | grep -E "^(experimental-features|trusted-users) ="
curl -I --max-time 10 https://cache.nixos.org/ | sed -n "1p"
readlink /run/current-system
'
```

Verified results on 2026-05-19:

```text
hostname: edge
ens18: 10.10.10.10/24
route: default via 10.10.10.1
sshd: active
qemu-guest-agent: active
nix: 2.31.5
trusted-users includes root and alex
cache.nixos.org: HTTP/2 200
current system: /nix/store/pljsz4b37krxmrl7x3x55asw4x5azggv-nixos-system-edge-25.11.20260514.d7a713c
```

## Recovery notes

### If the guest fails after a rebuild

Symptoms can include:

```text
Timed out waiting for device /dev/disk/by-label/nixos
```

Likely cause: initrd missing VirtIO disk modules.

Fix in the flake:

```nix
boot.initrd.availableKernelModules = [
  "ata_piix"
  "uhci_hcd"
  "virtio_pci"
  "virtio_blk"
  "virtio_scsi"
  "sd_mod"
  "sr_mod"
];
```

Then rebuild the qcow image and recreate VM 100 from the corrected image.

### If remote deploy fails with untrusted path/signature errors

Ensure `infra/modules/common.nix` includes:

```nix
nix.settings.trusted-users = [
  "root"
  "alex"
];
```

Then deploy again with `nixos-rebuild --target-host ... --sudo --no-reexec`.

### If direct build on guest is killed

The VM likely ran out of memory. Keep the guest small for now, but build locally and copy closures to the guest.

## Phase 2 readiness

Before starting Phase 2, the following are true:

- [x] Phase 1 runbook exists.
- [x] Dedicated Phase 1 completion runbook exists.
- [x] Infra flake exists and passes `nix flake check --no-build`.
- [x] Edge guest is deployed and reachable.
- [x] Edge guest can be redeployed declaratively.
- [x] Proxmox private bridge and NAT are verified.
- [x] The known VirtIO/initrd pitfall is documented.
- [x] The 1 GiB guest build/OOM pitfall is documented.

Next document to read before implementation:

```text
/home/alex/repos/ownloom/proxmox/runbooks/PHASE_2_EDGE_REVERSE_PROXY.md
```
