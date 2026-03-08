# Bloom OS Quick Deploy & Installation

> 📖 [Emoji Legend](LEGEND.md)

This guide covers the fastest dev path (QEMU) and production-style installation options.

```mermaid
flowchart TD
    Start([🚀 Deploy Bloom OS]) --> Q1{Development?}
    Q1 -->|Yes| QEMU[💻 Option A: QEMU<br/>just build → just qcow2 → just vm]
    Q1 -->|No| Q2{Bare metal / VM?}
    Q2 -->|Yes| ISO[💻 Option B: Installer ISO<br/>just iso]
    Q2 -->|No| Bootc[💻 Option C: bootc install<br/>Direct to disk]
    QEMU --> Setup[🚀 First Boot Setup]
    ISO --> Setup
    Bootc --> Setup
```

## 💻 Option A — QEMU (fastest for development)

### 🚀 1) Install host dependencies (Fedora)

```bash
sudo dnf install -y just qemu-system-x86 edk2-ovmf podman
```

### 🚀 2) Build Bloom OS image

```bash
just build
```

### 🚀 3) Generate VM disk (qcow2)

```bash
just qcow2
```

Output:

- `os/output/qcow2/disk.qcow2`

### 🚀 4) Boot VM

```bash
just vm
```

Forwarded host ports:

- `localhost:2222 -> guest:22` (SSH)
- `localhost:5000 -> guest:5000` (dufs WebDAV)

Headless mode:

```bash
just vm-serial
```

### 🚀 5) Log in

Default user comes from `os/bib-config.toml`:

- username: `bloom`
- SSH key auth: from `customizations.user.key`

If you want password auth, configure it explicitly in your bootc-image-builder config and rebuild.

### 🚀 6) Run first-boot setup

Follow the setup guide:

- `docs/pibloom-setup.md`

### 🚀 7) Stop VM

```bash
just vm-kill
```

---

## 💻 Option B — Installer ISO (VM manager / bare metal)

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

## 💻 Option C — Direct bootc install (advanced)

After building locally, install directly to a disk:

```bash
sudo bootc install to-disk /dev/sdX --source-imgref containers-storage:localhost/bloom-os:latest
```

Replace `/dev/sdX` with the target disk.

---

## Remote desktop (Xpra HTML5)

Bloom OS boots to `graphical.target` with a virtual display (Xvfb :99) managed by Xpra.
The Xpra HTML5 client is available on port 14500.

```bash
# Connect via browser — open in any web browser
http://<netbird-ip>:14500

# Or connect via native Xpra client
xpra attach tcp://<netbird-ip>:14500
```

The display runs headless — no physical monitor needed. If a monitor is connected,
greetd auto-attaches to the Xpra session on login.

## 🔗 Related

- [Emoji Legend](LEGEND.md) — Notation reference
- [First Boot Setup](pibloom-setup.md) — Initial configuration guide
- [Service Architecture](service-architecture.md) — Extensibility hierarchy details
