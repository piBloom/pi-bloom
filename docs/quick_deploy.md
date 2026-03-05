Fastest path (from this repo) is the built-in QEMU flow.

### 1) Install host deps (Fedora)

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

- Uses KVM + UEFI
- SSH port forwarding is configured (`localhost:2222 -> guest:22`)

Headless:

```bash
just vm-serial
```

### 5) Log in

Default user comes from `os/bib-config.toml`:

- username: `bloom`
- SSH key auth: from `customizations.user.key`

If you want password auth, configure it explicitly in your bootc-image-builder config and rebuild.

### 6) Stop VM

```bash
just vm-kill
```

---

If you want deployment through a VM manager (virt-manager/Proxmox/etc), build an installer ISO:

```bash
just iso
```

Use the generated ISO from `os/output/anaconda-iso/` as installation media.
