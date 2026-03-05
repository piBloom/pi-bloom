# Bloom OS Quick Deploy & Installation

This guide covers the fastest dev path (QEMU) and production-style installation options.

## Option A — QEMU (fastest for development)

### 1) Install host dependencies (Fedora)

```bash
sudo dnf install -y just qemu-system-x86 edk2-ovmf podman
```

### 2) Build Bloom OS image

```bash
just build
```

### 3) Generate VM disk (qcow2)

```bash
just qcow2
```

Output:

- `os/output/qcow2/disk.qcow2`

### 4) Boot VM

```bash
just vm
```

Forwarded host ports:

- `localhost:2222 -> guest:22` (SSH)
- `localhost:8384 -> guest:8384` (Syncthing Web UI)

Headless mode:

```bash
just vm-serial
```

### 5) Log in

Default user comes from `os/bib-config.toml`:

- username: `bloom`
- SSH key auth: from `customizations.user.key`

If you want password auth, configure it explicitly in your bootc-image-builder config and rebuild.

### 6) Run first-boot setup

Follow the setup guide:

- `docs/pibloom-setup.md`

### 7) Stop VM

```bash
just vm-kill
```

---

## Option B — Installer ISO (VM manager / bare metal)

Build installer media:

```bash
just iso
```

Use ISO from `os/output/anaconda-iso/` as installation media.

For OTA-oriented builds targeting GHCR image refs:

```bash
just iso-production
```

---

## Option C — Direct bootc install (advanced)

After building locally, install directly to a disk:

```bash
sudo bootc install to-disk /dev/sdX --source-imgref containers-storage:localhost/bloom-os:latest
```

Replace `/dev/sdX` with the target disk.

---

## Optional: Remote desktop (Sway + wayvnc)

Bloom OS boots to `graphical.target` with `greetd` and starts a Sway session for user `bloom`.
The Sway config starts `wayvnc` on `127.0.0.1:5901`.

Recommended access pattern:

```bash
ssh -N -L 5901:127.0.0.1:5901 bloom@<host>
```

Then connect your VNC client to `localhost:5901`.
