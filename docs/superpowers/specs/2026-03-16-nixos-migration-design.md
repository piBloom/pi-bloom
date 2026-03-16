# Bloom OS — NixOS Migration Design

**Date:** 2026-03-16
**Status:** Approved
**Scope:** Full migration from Fedora bootc to NixOS. No backwards compatibility. All features preserved.

---

## 1. Motivation

Fedora bootc treats the OS as an OCI container image. NixOS treats it as a purely declarative Nix expression. For Bloom OS the NixOS model is a better fit:

- Every package, service, user, and config option is a typed Nix attribute — no imperative shell scripts
- Generations give atomic updates and instant rollback without a separate image pull mechanism
- A single flake exposes multiple output formats (qcow2, raw, ISO) from one host definition
- Multi-architecture (x86_64 + future aarch64 RPi) is first-class in flakes
- No BIB, no container runtime, no bootc toolchain required to build or update

---

## 2. Constraints

- Target architecture: `x86_64-linux` (aarch64 slot reserved, not implemented in this spec)
- No backwards compatibility with Fedora bootc artifacts
- All current features must be preserved: Matrix homeserver, Pi daemon, NetBird, autologin, SSH, update timer, update-status.json protocol consumed by bloom-app
- As Nix-native as possible — no imperative workarounds baked into the image

---

## 3. Repository Structure

The `core/os/` directory is replaced entirely. The flake lives at the repo root alongside the existing TypeScript source.

```
flake.nix                        # flake inputs + outputs
flake.lock

core/os/
  hosts/
    x86_64.nix                   # x86_64 host: imports modules, sets machine options
  modules/
    bloom-app.nix                # Bloom TS app install, symlinks, Pi settings, pi-daemon user service
    bloom-matrix.nix             # Continuwuity Matrix homeserver service
    bloom-network.nix            # NetBird, SSH, firewall, NetworkManager, packages
    bloom-shell.nix              # pi user, autologin, sudoers, skel, branding
    bloom-update.nix             # nixos-rebuild OTA timer + Cachix substituter
  pkgs/
    bloom-app/default.nix        # buildNpmPackage derivation for the Bloom TS monorepo
    # continuwuity: pkgs.matrix-continuwuity from nixpkgs (confirmed in 25.11/unstable)
    # pi-coding-agent: sourced from llm-agents-nix flake input
  disk/
    x86_64-disk.nix              # disko: EFI + btrfs root layout

justfile                         # updated build/vm/deploy recipes
```

**Removed entirely:**
- `core/os/Containerfile`
- `core/os/bib.Containerfile`
- `core/os/build_files/` (all shell scripts)
- `core/os/packages/` (package lists, repos.sh)
- `core/os/system_files/` (all copied system files — replaced by NixOS module options)
- `core/os/disk_config/bib-config*.toml`

---

## 4. Flake Inputs & Outputs

```nix
inputs = {
  nixpkgs.url      = "github:NixOS/nixpkgs/nixos-unstable";
  nixos-generators = { url = "github:nix-community/nixos-generators"; inputs.nixpkgs.follows = "nixpkgs"; };
  disko            = { url = "github:nix-community/disko";            inputs.nixpkgs.follows = "nixpkgs"; };
  llm-agents-nix   = { url = "github:numtide/llm-agents.nix"; inputs.nixpkgs.follows = "nixpkgs"; };
  # home-manager reserved for future user environment management
};

outputs = { nixpkgs, nixos-generators, disko, llm-agents-nix, self, ... }: {
  packages.x86_64-linux = {
    bloom-app = ...;   # buildNpmPackage derivation (only custom derivation)
    # continuwuity: pkgs.matrix-continuwuity from nixpkgs
    # pi: inputs.llm-agents-nix.packages.x86_64-linux.pi
    qcow2        = nixos-generators.nixosGenerate { format = "qcow2";       ... };
    raw          = nixos-generators.nixosGenerate { format = "raw";         ... };
    iso          = nixos-generators.nixosGenerate { format = "install-iso"; ... };
  };

  nixosConfigurations.bloom-x86_64 = nixpkgs.lib.nixosSystem {
    system  = "x86_64-linux";
    modules = [ disko.nixosModules.disko ./core/os/hosts/x86_64.nix ];
    specialArgs = { inherit self; };
  };
};
```

`nixos-generators` calls also include `disko.nixosModules.disko` so the same disk layout is shared across all build formats. `specialArgs` passes `self` so modules can reference pinned derivations from the flake.

**Note on `llm-agents.nix`:** The `github:numtide/llm-agents.nix` flake packages `pi` (`github:badlogic/pi-mono` by Mario Zechner — same project as `@mariozechner/pi-coding-agent`). Used as `inputs.llm-agents-nix.packages.x86_64-linux.pi` — no custom derivation needed.

---

## 5. Package Derivations

One custom derivation (`bloom-app`). Everything else sourced from nixpkgs or upstream flake inputs.

### 5.1 `pkgs/bloom-app/default.nix` — `buildNpmPackage`

Packages the Bloom TypeScript monorepo:

- Source: repo root filtered to exclude `node_modules`, `dist`, `coverage`, `core/os`
- `package-lock.json` must be lockfile format v3; `npmDepsHash` pinned in derivation
- Build phase: `npm run build`
- Install phase: copies `dist/`, `package.json`, `node_modules` to `$out/share/bloom`
- Post-install: creates `@mariozechner/pi-coding-agent` and `@mariozechner/pi-ai` symlinks into `$out/share/bloom/node_modules/@mariozechner/` pointing at the `pi` package output from `llm-agents-nix` (passed as a build input via `specialArgs`)
- Pi `settings.json` (`{"packages": ["/usr/local/share/bloom"]}`) and back-compat `persona`/`skills` symlinks handled here

### 5.2 Continuwuity — `pkgs.matrix-continuwuity` from nixpkgs

Confirmed present in nixpkgs 25.11/unstable (`matrix-continuwuity`). No custom derivation needed. Replaces the multi-stage Docker copy in the current Containerfile. Referenced in `bloom-matrix.nix` as `pkgs.matrix-continuwuity`.

### 5.3 Pi coding agent — from `llm-agents-nix`

`inputs.llm-agents-nix.packages.x86_64-linux.pi` — the `pi` package in `llm-agents.nix` is `github:badlogic/pi-mono` by Mario Zechner, the same project as `@mariozechner/pi-coding-agent`. Used as `pkgs.pi` via overlay or direct input reference. The `@mariozechner/pi-ai` transitive dependency is included by the llm-agents.nix package. Bloom's `node_modules` symlinks point at this package output.

### 5.4 Packages from nixpkgs (no derivation needed)

`pkgs.netbird`, `pkgs.vscode`, `pkgs.chromium`, `pkgs.git`, `pkgs.git-lfs`, `pkgs.gh`, `pkgs.ripgrep`, `pkgs.fd`, `pkgs.bat`, `pkgs.htop`, `pkgs.just`, `pkgs.shellcheck`, `pkgs.podman`, `pkgs.buildah`, `pkgs.skopeo`, `pkgs.oras`, `pkgs.qemu`, `pkgs.biome`, `pkgs.typescript`, `pkgs.jq`, `pkgs.curl`, `pkgs.wget`, `pkgs.unzip`, `pkgs.openssl`

---

## 6. NixOS Modules

### 6.1 `bloom-app.nix`

- Installs `bloom-app` derivation; app lives at `/usr/local/share/bloom` via `systemd.tmpfiles.rules` symlink from the Nix store path
- Adds `pi-coding-agent`, `biome`, `typescript` to `environment.systemPackages`
- Writes `/etc/bloom/appservices/` directory via `systemd.tmpfiles.rules`
- Writes Pi `settings.json` via `environment.etc."local/share/bloom/.pi/agent/settings.json"`
- `pi-daemon` **user** service declared via `systemd.user.services.pi-daemon`:
  - `ExecStart`: `node /usr/local/share/bloom/dist/core/daemon/index.js`
  - `After=network-online.target` — **does not list `bloom-matrix.service`**: user manager cannot order against system units; ordering is removed. The Pi daemon already has `ConditionPathExists=%h/.bloom/.setup-complete` which gates startup until setup completes, and it has `Restart=on-failure` with `RestartSec=15` to recover if Matrix is not yet ready.
  - `Restart=on-failure`, `RestartSec=15`
  - `WantedBy=default.target`

### 6.2 `bloom-matrix.nix`

No upstream NixOS service module exists for continuwuity — service declared manually:

- `systemd.services.bloom-matrix`:
  - `serviceConfig.ExecStartPre`: shell fragment that generates `/var/lib/continuwuity/registration_token` on first boot. Uses `pkgs.openssl` via explicit `serviceConfig.ExecStartPre` wrapper or `path = [ pkgs.openssl pkgs.bash ]` on the service to ensure openssl is in PATH.
  - `serviceConfig.ExecStart`: `${pkgs.matrix-continuwuity}/bin/continuwuity`
  - `serviceConfig.Environment`: `CONTINUWUITY_CONFIG=/etc/bloom/matrix.toml`
  - `serviceConfig.DynamicUser = true`
  - `serviceConfig.StateDirectory = "continuwuity"`
  - `serviceConfig.RuntimeDirectory = "continuwuity"`
  - `serviceConfig.Restart = "on-failure"`, `serviceConfig.RestartSec = 5`
  - `unitConfig.After = "network-online.target"`
  - `unitConfig.Wants = "network-online.target"`
- Matrix config written via `environment.etc."bloom/matrix.toml".source`
- `wantedBy = [ "multi-user.target" ]`

### 6.3 `bloom-network.nix`

- `services.netbird.enable = true` — replaces netbird repo + RPM install
- `services.openssh.enable = true`
- `services.openssh.settings.PasswordAuthentication = true` — matches current `50-bloom.conf` (password auth enabled, public key auth disabled). Note: this is the current live config; key-based auth can be added later as a deliberate change.
- `services.openssh.settings.PubkeyAuthentication = "no"` — string `"no"` used explicitly (not Nix bool `false`) to match the NixOS OpenSSH module's expected type and avoid coercion ambiguity. This deliberately disables key-based auth to match the current `50-bloom.conf`.
- `networking.firewall.trustedInterfaces = [ "wt0" ]` — replaces `firewall-offline-cmd --zone=trusted --add-interface=wt0`
- `networking.networkmanager.enable = true`
- Optional WiFi: module declares `options.bloom.wifi.ssid` and `options.bloom.wifi.psk` (strings, default `""`). When set, writes `/etc/NetworkManager/system-connections/wifi.nmconnection` via `environment.etc` with `mode = "0600"`. Replaces `WIFI_SSID`/`WIFI_PSK` build args.
- `environment.systemPackages`: all development tools listed in §5.4

### 6.4 `bloom-shell.nix`

- `users.users.pi` — stable uid, `wheel` group, home `/home/pi`, shell `pkgs.bash`
- `security.sudo.extraRules` — `pi` gets passwordless sudo (replaces `sudoers.d/10-bloom`)
- `services.getty.autologinUser = "pi"` — autologin on tty1
- Serial autologin on `ttyS0`:
  ```nix
  systemd.services."serial-getty@ttyS0" = {
    overrideStrategy = "asDropin";
    serviceConfig.ExecStart = lib.mkForce [
      ""  # clear upstream ExecStart
      "${pkgs.util-linux}/sbin/agetty --autologin pi --keep-baud 115200,57600,38400,9600 ttyS0 $TERM"
    ];
  };
  ```
  This correctly overrides without inheriting conflicting ExecStart lines from the upstream unit.
- `systemd.tmpfiles.rules`: `"C /home/pi/.bashrc 0644 pi pi - /etc/skel/.bashrc"` and same for `.bash_profile`. The `C` type copies the file only if it does not exist, so first-boot creates the dotfiles without overwriting user edits on subsequent updates.
- `environment.etc."skel/.bashrc"` and `"skel/.bash_profile"` — canonical source for skel
- `environment.etc."issue"` — login branding
- `boot.kernel.sysctl` — console sysctl settings (replaces `60-bloom-console.conf`)
- `networking.hostName = "bloom"` — default hostname, overridable per host

### 6.5 `bloom-update.nix`

- `nix.settings.experimental-features = [ "nix-command" "flakes" ]` — required for `nixos-rebuild` in flake mode
- `nix.settings.substituters = [ "https://cache.nixos.org" "<cachix-url>" ]`
- `nix.settings.trusted-public-keys = [ "cache.nixos.org-1:..." "<cachix-pubkey>" ]` — Cachix public key declared here so updates pull pre-built closures instead of compiling on device
- `systemd.services.bloom-update`:
  - Runs as root
  - `path = with pkgs; [ nix git ]` — `nix` and `git` needed by `nixos-rebuild --flake github:...`; `nixos-rebuild` itself is already on the system PATH at `/run/current-system/sw/bin/nixos-rebuild` and must not be added via `pkgs.nixos-rebuild` (that attribute does not exist in nixpkgs)
  - `ExecStart`: shell script that runs `nixos-rebuild switch --flake github:alexradunet/piBloom#bloom-x86_64`, then writes `/home/pi/.bloom/update-status.json` with result (see §6.5.1). File written to the absolute path `/home/pi/.bloom/` — not `~/` — because the service runs as root and `~` would expand to `/root`.
  - `Type = oneshot`
  - `unitConfig.After = "network-online.target"`
  - `unitConfig.Wants = "network-online.target"`
- `systemd.timers.bloom-update` — same schedule as current `bloom-update-check.timer`

#### 6.5.1 update-status.json protocol

The current `bloom-update-check.sh` writes `~/.bloom/update-status.json` with fields consumed by the bloom-app daemon. This protocol is preserved with NixOS-native fields:

```json
{
  "checked": "<ISO8601>",
  "available": false,
  "generation": "<current nixos generation number>",
  "notified": false
}
```

The `bloom-update` service script:
1. Before applying: compares current generation with what the remote flake would produce (via `nix flake metadata` diff against `flake.lock`)
2. Writes `available: true/false` based on whether a change was detected
3. If `available`, runs `nixos-rebuild switch` and updates `generation`
4. Drops the `staged` field (no staging in NixOS — apply is atomic)

**Note:** The bloom-app TypeScript code that reads `update-status.json` must be updated to handle the removal of the `staged` field and the addition of `generation`. This is a coordinated change — bloom-app TypeScript and `bloom-update.nix` are updated together.

---

## 7. Host Configuration — `hosts/x86_64.nix`

```nix
{ pkgs, lib, ... }: {
  imports = [
    ../modules/bloom-app.nix
    ../modules/bloom-matrix.nix
    ../modules/bloom-network.nix
    ../modules/bloom-shell.nix
    ../modules/bloom-update.nix
  ];

  system.stateVersion = "25.05";    # backwards-compat marker only; safe on nixos-unstable
  nixpkgs.hostPlatform = "x86_64-linux";

  boot.loader.systemd-boot.enable = true;
  boot.loader.efi.canTouchEfiVariables = true;

  disko.devices = import ../disk/x86_64-disk.nix;

  time.timeZone = "UTC";
  i18n.defaultLocale = "en_US.UTF-8";
}
```

---

## 8. Disk Layout — `disk/x86_64-disk.nix`

Declarative via disko. Replaces `bib-config.toml` filesystem block and `bootc install/config.toml`:

- 512 MiB FAT32 EFI partition mounted at `/boot`
- btrfs root partition (remainder, minimum 40 GiB total disk) mounted at `/`
- No swap partition (matches current setup)

**Build-time vs install-time distinction:**
- For `qcow2` and `raw` formats: disko partitions and formats the image at `nix build` time
- For `install-iso`: disko does **not** partition at ISO build time — the ISO is a live installer. Partitioning happens at install time via `disko-install` run from the booted ISO. This replaces `bootc install to-disk`.

---

## 9. Image Generation

`nixos-generators` replaces `bootc-image-builder` entirely. The `bib.Containerfile` and the python3-mako workaround are deleted.

| Format | Recipe | Output | Disk layout |
|--------|--------|--------|-------------|
| qcow2  | `nix build .#qcow2` | `result/disk.qcow2` | disko at build time |
| raw    | `nix build .#raw`   | `result/disk.raw`   | disko at build time |
| ISO    | `nix build .#iso`   | `result/iso/nixos.iso` | disko-install at install time |

All three formats are built from the same `hosts/x86_64.nix` definition. No separate config file needed.

---

## 10. Updated justfile

```just
system    := "x86_64-linux"
flake     := "."
host      := "bloom-x86_64"
output    := "result"
ovmf      := "/usr/share/edk2/ovmf/OVMF_CODE.fd"
ovmf_vars := "/usr/share/edk2/ovmf/OVMF_VARS.fd"

# Build Bloom app derivation
build:
    nix build {{ flake }}#bloom-app

# Generate disk images
qcow2: nix build {{ flake }}#qcow2
raw:   nix build {{ flake }}#raw
iso:   nix build {{ flake }}#iso

# Apply config to running system (local dev iteration)
switch:
    sudo nixos-rebuild switch --flake {{ flake }}#{{ host }}

# Apply from remote flake (mirrors what bloom-update does on device)
update:
    sudo nixos-rebuild switch --flake github:alexradunet/piBloom#{{ host }}

# Roll back to previous generation
rollback:
    sudo nixos-rebuild switch --rollback

# Boot qcow2 in QEMU headless
vm:
    #!/usr/bin/env bash
    set -euo pipefail
    vars="/tmp/bloom-ovmf-vars.fd"
    cp "{{ ovmf_vars }}" "$vars"
    qemu-system-x86_64 \
        -machine q35 -cpu host -enable-kvm -m 12G -smp 2 \
        -drive if=pflash,format=raw,readonly=on,file={{ ovmf }} \
        -drive if=pflash,format=raw,file="$vars" \
        -drive file={{ output }}/disk.qcow2,format=qcow2,if=virtio \
        -netdev user,id=net0,hostfwd=tcp::2222-:22,hostfwd=tcp::8080-:8080 \
        -device virtio-net-pci,netdev=net0 \
        -nographic -serial mon:stdio

# Boot qcow2 with GUI
vm-gui:
    #!/usr/bin/env bash
    set -euo pipefail
    vars="/tmp/bloom-ovmf-vars.fd"
    cp "{{ ovmf_vars }}" "$vars"
    qemu-system-x86_64 \
        -machine q35 -cpu host -enable-kvm -m 12G -smp 2 \
        -drive if=pflash,format=raw,readonly=on,file={{ ovmf }} \
        -drive if=pflash,format=raw,file="$vars" \
        -drive file={{ output }}/disk.qcow2,format=qcow2,if=virtio \
        -netdev user,id=net0,hostfwd=tcp::2222-:22,hostfwd=tcp::8080-:8080 \
        -device virtio-net-pci,netdev=net0 \
        -device virtio-vga-gl -display gtk,gl=on

# Test ISO install in QEMU headless
test-iso:
    #!/usr/bin/env bash
    set -euo pipefail
    disk="/tmp/bloom-test-disk.qcow2"
    vars="/tmp/bloom-ovmf-vars.fd"
    rm -f "$disk" "$vars"
    qemu-img create -f qcow2 "$disk" 40G
    cp "{{ ovmf_vars }}" "$vars"
    qemu-system-x86_64 \
        -machine q35 -cpu host -enable-kvm -m 8G -smp 2 \
        -drive if=pflash,format=raw,readonly=on,file={{ ovmf }} \
        -drive if=pflash,format=raw,file="$vars" \
        -drive file="$disk",format=qcow2,if=virtio \
        -cdrom {{ output }}/iso/nixos.iso \
        -netdev user,id=net0,hostfwd=tcp::2222-:22 \
        -device virtio-net-pci,netdev=net0 \
        -nographic -serial mon:stdio

vm-ssh:
    ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p 2222 pi@localhost

vm-kill:
    pkill -f "[q]emu-system-x86_64.*disk.qcow2" || true

clean:
    rm -f result result-*

# Install host deps — targets Fedora build host (developers on NixOS use nix develop instead)
deps:
    sudo dnf install -y just qemu-system-x86 edk2-ovmf

# Nix devShell (alternative to deps for NixOS developers)
# nix develop — provides just, qemu, edk2-ovmf via shell.nix / devShells in flake

lint:
    nix flake check
    statix check .

fmt:
    nixfmt core/os/**/*.nix flake.nix
```

**Removed recipes:** `build-bib` (BIB workaround gone entirely)
**New recipes:** `switch`, `update`, `rollback`, `lint`, `fmt`

---

## 11. Update Flow

```
bloom-update.timer (fires on schedule)
  → bloom-update.service (root, After=network-online.target)
    → checks if remote flake differs from local flake.lock
    → writes /home/pi/.bloom/update-status.json: {checked, available, generation, notified}
    → if available: nixos-rebuild switch --flake github:alexradunet/piBloom#bloom-x86_64
        → pulls pre-built closures from Cachix (no on-device compilation)
        → activates new generation atomically
        → old generation remains as systemd-boot entry for rollback
```

Manual rollback: `just rollback` or select previous generation in systemd-boot menu at boot.

**CI prerequisite:** Before committing `flake.lock` updates, CI must push the new closure to Cachix. Without this gate, `bloom-update.service` on device will attempt to build from source on the next timer fire, which will OOM or time out. The CI/CD pipeline (to be designed separately) must enforce: build → push to Cachix → commit lock update.

---

## 12. What Is Not Changing

- TypeScript source, daemon, extensions, services — unchanged
- justfile QEMU flags — unchanged (same hardware config)
- Matrix config content (`matrix.toml`) — unchanged, just sourced differently
- Pi user conventions (`/home/pi`, `BLOOM_DIR`, `.bloom/`) — unchanged
- Port forwarding, SSH access patterns — unchanged

---

## 13. Coordinated Changes Required Outside This Spec

These changes to the TypeScript layer must accompany the NixOS migration:

1. **bloom-app update-status.json consumer**: Remove `staged` field handling, add `generation` field handling. The update mechanism no longer stages — it applies atomically.
2. **update-check TypeScript code**: The `bootc upgrade --check` and `bootc status` calls in `bloom-update-check.sh` are replaced by the Nix-native service. Any TypeScript code that shells out to `bootc` must be removed or replaced.
