# Bloom OS Quick Deploy

> 📖 [Emoji Legend](LEGEND.md)

This guide matches the current `justfile`.

## Prerequisites

Fedora host dependencies:

```bash
sudo dnf install -y just podman qemu-system-x86 edk2-ovmf
```

Create a local bootc-image-builder config before generating images:

```bash
cp os/disk_config/bib-config.example.toml os/disk_config/bib-config.toml
```

Edit `os/disk_config/bib-config.toml` with your desired password, SSH key, and optional customizations.

## Fast Dev Path: QEMU

```bash
just build
just qcow2
just vm
```

Important outputs:

- image tag default: `localhost/bloom-os:latest`
- qcow2 path: `os/output/qcow2/disk.qcow2`

Forwarded ports in `just vm`:

- `2222` -> guest SSH
- `5000` -> `dufs`
- `8080`
- `8081`
- `8888` -> guest port `80`

Access the VM:

```bash
just vm-ssh
```

Stop it:

```bash
just vm-kill
```

## ISO Build

Build a local installer ISO:

```bash
just iso
```

Build a production-style ISO flow:

```bash
just iso-production
```

Both write outputs under `os/output/`.

## Direct bootc Install

For advanced manual installation after a local build:

```bash
sudo bootc install to-disk /dev/sdX --source-imgref containers-storage:localhost/bloom-os:latest
```

Replace `/dev/sdX` with the target disk.

## Related Commands

```bash
just deps
just clean
just lint-os
```

## After Boot

On first login:

1. complete `bloom-wizard.sh`
2. let Pi resume the persona step
3. use `setup_status` if you need to inspect or resume the Pi-side setup state

See [docs/pibloom-setup.md](pibloom-setup.md) for the full first-boot flow.
Use [docs/live-testing-checklist.md](live-testing-checklist.md) as the acceptance checklist for a fresh device run.
