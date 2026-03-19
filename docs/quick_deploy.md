# nixPI Quick Deploy

> 📖 [Emoji Legend](LEGEND.md)

Audience: operators and maintainers installing nixPI on NixOS or running test VMs.

> 🛡️ **Security Note: NetBird is Mandatory**
>
> NetBird is the network security boundary for all nixPI services. The firewall
> trusts only the NetBird interface (`wt0`). Without NetBird running, all services
> (Matrix, Home, dufs, code-server) are exposed to the local network.
>
> **Complete NetBird setup and verify `wt0` is active before exposing this
> machine to any network.** See [security-model.md](security-model.md) for the
> full threat model.

## 🌱 Installation Workflow

nixPI is installed on top of a standard NixOS system:

1. **Install NixOS** using the [official NixOS ISO](https://nixos.org/download.html)
   - Choose your preferred desktop environment during installation
   - Set up your user, hostname, and basic system configuration
   - Complete the standard NixOS install process

2. **Switch to the nixPI flake** after first boot:
   ```bash
   sudo nixos-rebuild switch --flake github:alexradunet/piBloom#desktop
   ```

3. **Complete first-boot setup** — the `setup-wizard.sh` runs automatically on first login

## 💻 Development: VM Testing

For development and testing, use the QEMU VM workflow:

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

### VM Commands

```bash
just vm         # Build and run VM (headless, serial console)
just vm-gui     # Run VM with GUI display
just vm-ssh     # SSH into running VM
just vm-stop    # Stop the VM
```

Forwarded ports in `just vm`:

- `2222` -> guest SSH
- `5000` -> `dufs`
- `8080` -> guest port `8080`
- `8081` -> `fluffychat`
- `8888` -> guest port `80`

Default user: `pi` (no initial password; TTY auto-login prompts for password creation on first boot).

## 🔄 OTA Updates

The `nixpi-update` timer checks for updates every 6 hours automatically. To apply manually:

```bash
just update          # pull from remote flake and switch
just rollback        # revert to previous generation
```

Or directly:

```bash
sudo nixos-rebuild switch --flake github:alexradunet/piBloom#desktop
```

## 📚 Reference

Common `just` commands:

```bash
just deps            # Install build dependencies
just switch          # Apply local flake to running system
just update          # Apply remote flake to running system
just rollback        # Revert to previous generation
just clean           # Remove build artifacts
just lint            # Run nix flake check
just fmt             # Format Nix files

# VM commands
just vm              # Run VM (headless)
just vm-gui          # Run VM with GUI display
just vm-ssh          # SSH into running VM
just vm-stop         # Stop running VM

# Testing commands
just check-config    # Fast: validate NixOS config
just check-boot      # Thorough: boot test in VM
```

After first login:

1. Complete `setup-wizard.sh` (prompted automatically on tty1)
2. Let Pi resume the persona step
3. Use `setup_status` if you need to inspect or resume Pi-side setup state

## 🔗 Related

- [first-boot-setup.md](first-boot-setup.md)
- [live-testing-checklist.md](live-testing-checklist.md)
